'use strict';

const querystring = require('querystring');
const parser = require('content-type');

const {
  HTTP_HEADER_CONTENT_TYPE
} = require('@fabric/core/constants');
const { PREFERRED_CONTENT_TYPE } = require('@fabric/http/constants');
const HttpRemote = require('@fabric/http/types/remote');

const { httpsRequestCaptured } = require('../services/outboundHttps');

/**
 * Fabric {@link HttpRemote} with Node {@link https.request}: HTTPS-only, default CA validation,
 * and optional `tlsServiceId` for TLS telemetry (see {@link ../services/outboundTelemetry}).
 */
class FeedHttpRemote extends HttpRemote {
  /**
   * @param {object} [config]
   * @param {string} [config.tlsServiceId] Passed to TLS telemetry hook.
   */
  constructor (config = {}) {
    super(config);
    return this;
  }

  _tlsCaptureId () {
    const id = this.settings.tlsServiceId;
    return id != null && String(id).trim() !== ''
      ? String(id).trim()
      : 'https';
  }

  /**
   * @param {String} type
   * @param {String} path
   * @param {Object} [params]
   */
  async request (type, path, params = {}) {
    const self = this;

    if (this.settings.secure === false) {
      const err = new Error(
        'FeedHttpRemote: outbound HTTP (non-TLS) is disabled for quote integrations'
      );
      err.code = 'EHTTPS_REQUIRED';
      throw err;
    }

    let url = this.authority + path;
    let result = null;

    let headers = {
      Accept: PREFERRED_CONTENT_TYPE,
      'Content-Type': HTTP_HEADER_CONTENT_TYPE
    };

    if (params.headers) {
      headers = Object.assign({}, headers, params.headers);
    }

    if (this.settings.macaroon) {
      headers = Object.assign({}, headers, {
        Macaroon: this.settings.macaroon,
        EncodingType: 'hex'
      });
    }

    if (this.settings.username || this.settings.password) {
      headers.Authorization = `Basic ${Buffer.from([
        this.settings.username || '',
        this.settings.password || ''
      ].join(':')).toString('base64')}`;
    }

    /** @type {string | Buffer | null} */
    let bodySend = null;

    switch (params.mode) {
      case 'query':
        url += '?' + querystring.stringify(params.body);
        break;
      default:
        if (params.body != null && params.body !== '') {
          if (typeof params.body === 'string') {
            bodySend = params.body;
          } else {
            try {
              bodySend = JSON.stringify(params.body);
            } catch (exception) {
              console.error('[FEED:REMOTE] Could not stringify body:', exception);
              bodySend = null;
            }
          }
        }
        break;
    }

    this.emit('warning', `Requesting: ${url}`);

    /** @type {Awaited<ReturnType<typeof httpsRequestCaptured>> | null} */
    let captured = null;
    try {
      captured = await httpsRequestCaptured({
        url,
        method: String(type || 'GET').toUpperCase(),
        headers,
        body: bodySend,
        tlsServiceId: this._tlsCaptureId()
      });
    } catch (e) {
      self.emit('error', `[FEED:REMOTE] exception: ${e}`);
      return {
        status: 'error',
        message: e && e.message ? String(e.message) : 'No response to request.'
      };
    }

    if (!captured) {
      return {
        status: 'error',
        message: 'No response to request.'
      };
    }

    const statusCode = captured.statusCode;

    switch (statusCode) {
      case 404:
        result = {
          status: 'error',
          message: 'Document not found.'
        };
        break;
      default: {
        const ok = statusCode >= 200 && statusCode < 300;
        if (ok) {
          const ctRaw = captured.headers['content-type'];
          const ctStr = Array.isArray(ctRaw) ? ctRaw[0] : ctRaw;
          const formatter = parser.parse(ctStr || '');
          switch (formatter.type) {
            case 'application/json':
              try {
                result = JSON.parse(captured.bodyBuf.toString('utf8'));
              } catch (E) {
                console.error('[FEED:REMOTE]', 'Could not parse JSON:', E);
                result = captured.bodyBuf.toString('utf8');
              }

              if (this.settings.debug) {
                const pag = captured.headers['x-pagination'];
                if (pag) {
                  console.debug('Has pagination:', captured.headers);
                }
              }
              break;
            default:
              if (this.settings.verbosity >= 4) {
                self.emit(
                  'warning',
                  `[FEED:REMOTE] Unhandled content type: ${formatter.type}`
                );
              }
              result = captured.bodyBuf.toString('utf8');
              break;
          }
        } else {
          if (this.settings.verbosity >= 4) {
            console.warn(
              '[FEED:REMOTE]',
              'Unhandled HTTP status code:',
              statusCode
            );
          }
          result = {
            status: 'error',
            message: 'Unhandled HTTP status code.',
            code: statusCode
          };
        }
        break;
      }
    }

    return result;
  }
}

module.exports = FeedHttpRemote;
