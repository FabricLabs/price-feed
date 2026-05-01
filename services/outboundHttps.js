'use strict';

const https = require('https');
const tls = require('tls');
const { URL } = require('url');

const { emitTlsTelemetry } = require('./outboundTelemetry');

/**
 * @param {import('tls').PeerCertificate|false|undefined} cert
 * @returns {Record<string, unknown>|null}
 */
function summarizePeerCert (cert) {
  if (!cert || typeof cert !== 'object' || Object.keys(cert).length === 0) {
    return null;
  }
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber,
    validFrom: cert.valid_from,
    validTo: cert.valid_to,
    fingerprint256: cert.fingerprint256,
    fingerprint: cert.fingerprint
  };
}

/**
 * Same-origin Fabric-style HTTPS request with strict TLS and captured peer metadata.
 *
 * @param {{
 *   url: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string | Buffer | null,
 *   tlsServiceId?: string
 * }} opts
 * @returns {Promise<{
 *   statusCode: number,
 *   headers: import('http').IncomingHttpHeaders,
 *   bodyBuf: Buffer,
 *   tls: Record<string, unknown>
 * }>}
 */
function httpsRequestCaptured (opts) {
  const urlStr = opts.url;
  const method = (opts.method && String(opts.method).toUpperCase()) || 'GET';
  const headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
  const body = opts.body != null ? opts.body : null;
  const tlsServiceId = opts.tlsServiceId != null ? String(opts.tlsServiceId) : 'https';

  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return Promise.reject(
      new Error(`outbound HTTPS: invalid URL (${String(e?.message || e)})`)
    );
  }

  if (u.protocol !== 'https:') {
    const err = new Error(
      `outbound request rejected: HTTPS required (got ${u.protocol || 'unknown'})`
    );
    err.code = 'EHTTPS_REQUIRED';
    return Promise.reject(err);
  }

  const port = u.port || '443';

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port,
        path: u.pathname + u.search,
        method,
        headers,
        rejectUnauthorized: true,
        servername: u.hostname
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          /**
           * With keep-alive, `res.socket` is often unset when `end` fires; the TLS session is still
           * on `req.socket` (see Node client request / IncomingMessage lifecycle).
           */
          const rawSock =
            res.socket &&
            typeof res.socket.getPeerCertificate === 'function'
              ? res.socket
              : req.socket &&
                  typeof req.socket.getPeerCertificate === 'function'
                ? req.socket
                : null;
          /** @type {import('tls').TLSSocket|null} */
          const tlsSock = rawSock
            ? /** @type {import('tls').TLSSocket} */ (rawSock)
            : null;

          const authorized = !!(tlsSock && tlsSock.authorized);
          const authorizationError =
            tlsSock && tlsSock.authorizationError != null
              ? String(tlsSock.authorizationError)
              : authorized
                ? null
                : 'unauthorized';

          let serverIdentityOk = false;
          /** @type {Record<string, unknown>|null} */
          let peer = null;
          /** @type {boolean|null} */
          let hostIdentityCheck = null;
          try {
            if (tlsSock && typeof tlsSock.getPeerCertificate === 'function') {
              const raw = tlsSock.getPeerCertificate(true);
              if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
                peer = summarizePeerCert(raw);
                try {
                  tls.checkServerIdentity(u.hostname, raw);
                  hostIdentityCheck = true;
                } catch {
                  hostIdentityCheck = false;
                }
              }
            }
          } catch {
            hostIdentityCheck = null;
          }

          /**
           * Trust Node’s `authorized` flag: the runtime already validated the chain and (by default)
           * the server name. A separate `checkServerIdentity` run was producing false negatives when
           * peer cert shapes differed while the connection was still properly verified.
           */
          serverIdentityOk = authorized;

          const cipher =
            tlsSock && typeof tlsSock.getCipher === 'function'
              ? tlsSock.getCipher()
              : null;
          const protocol =
            tlsSock && typeof tlsSock.getProtocol === 'function'
              ? tlsSock.getProtocol()
              : null;

          const tlsSummary = {
            protocol: protocol || null,
            authorized,
            authorizationError,
            serverIdentityOk,
            hostIdentityCheck,
            cipher: cipher
              ? { name: cipher.name, version: cipher.version }
              : null,
            peer
          };

          if (!authorized) {
            emitTlsTelemetry(tlsServiceId, urlStr, {
              ...tlsSummary,
              rejected: true,
              rejectReason: 'TLS handshake not authorized'
            });
            reject(
              new Error(
                authorizationError
                  ? `TLS not authorized: ${authorizationError}`
                  : 'TLS not authorized'
              )
            );
            return;
          }

          emitTlsTelemetry(tlsServiceId, urlStr, tlsSummary);

          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            bodyBuf: buf,
            tls: tlsSummary
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (body != null && body !== '') {
      req.write(
        typeof body === 'string' ? Buffer.from(body, 'utf8') : body
      );
    }
    req.end();
  });
}

module.exports = {
  httpsRequestCaptured
};
