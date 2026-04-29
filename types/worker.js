'use strict';

/**
 * One **Worker** per outbound HTTP integration: owns a Fabric {@link Remote} for a single
 * authority and exposes small verbs (`get`, `post`, `request`) used by quote services.
 *
 * `serviceId` is stable configuration (e.g. `bitpay`); `label` is used with
 * {@link throwIfFabricHttpError} in callers when set explicitly.
 *
 * **Outbound policy:** every {@link Worker#get}, {@link Worker#post}, and {@link Worker#request}
 * is bounded by a per-instance deadline (`timeoutMs`, default 14s) so a stuck TCP call cannot
 * hang callers forever. Pass `timeoutMs` in constructor settings to override.
 *
 * **Rate limits:** static {@link Worker.errorIndicatesRateLimit} and
 * {@link Worker.rateLimitBackoffMs} are used by {@link ../services/feed} for HTTP 429/503 backoff
 * when aggregating quotes.
 */

const Remote = require('./feedHttpRemote');

/**
 * Detect HTTP rate-limit / throttle errors surfaced as thrown {@link Error} messages
 * (e.g. {@link ./remoteResponse.throwIfFabricHttpError} appends `[429]`).
 * @param {unknown} err
 * @returns {boolean}
 */
function errorIndicatesRateLimit (err) {
  if (!err) return false;
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? Number(/** @type {{ code?: unknown }} */ (err).code)
      : NaN;
  if (code === 429 || code === 503) return true;
  const m =
    typeof err === 'object' && err !== null && 'message' in err
      ? String(/** @type {{ message?: unknown }} */ (err).message)
      : String(err);
  if (/\b429\b/.test(m) || /Rate limit/i.test(m)) return true;
  if (/\b503\b/.test(m) || /Service unavailable/i.test(m)) return true;
  return false;
}

/**
 * Logistic (smooth saturating) delay in ms plus light jitter. Consecutive failures increase
 * `streak` so delay approaches `maxMs`.
 *
 * @param {number} streak 1-based count since last full fetch success (first throttle → 1).
 * @param {() => number} [rng] unit uniform in [0,1); default `Math.random`.
 * @returns {number} delay in milliseconds
 */
function rateLimitBackoffMs (streak, rng = Math.random) {
  const s = Math.max(1, Math.floor(Number(streak)) || 1);
  const n = s - 1;
  const minMs = 2500;
  const maxMs = 120_000;
  const k = 0.42;
  const mid = 4;
  const logistic = 1 / (1 + Math.exp(-k * (n - mid)));
  const base = minMs + logistic * (maxMs - minMs);
  const jitter = 0.88 + rng() * 0.24;
  return Math.min(maxMs, Math.round(base * jitter));
}

/**
 * @param {string} id
 * @returns {string}
 */
function defaultLabelFromServiceId (id) {
  const s = String(id || '').trim();
  if (!s) return 'HTTP';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

class Worker {
  /** @see errorIndicatesRateLimit */
  static errorIndicatesRateLimit (err) {
    return errorIndicatesRateLimit(err);
  }

  /** @see rateLimitBackoffMs */
  static rateLimitBackoffMs (streak, rng) {
    return rateLimitBackoffMs(streak, rng);
  }

  /**
   * @param {Object} settings
   * @param {string} settings.serviceId Non-empty id (e.g. `coinbase`, `bitpay`).
   * @param {string} [settings.label] Prefix for HTTP error messages (defaults from `serviceId`).
   * @param {string} [settings.authority] Remote host (see `@fabric/http` Remote).
   * @param {string} [settings.host] Alias for authority when authority omitted.
   * @param {boolean} [settings.secure]
   * @param {number} [settings.port]
   * @param {boolean} [settings.debug]
   * @param {number} [settings.timeoutMs] Per-request ceiling in ms (min 500 when set; default 14_000).
   * …plus any other {@link Remote} constructor options merged in.
   */
  constructor (settings = {}) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Worker requires a settings object');
    }

    const serviceIdRaw = settings.serviceId;
    const serviceId =
      serviceIdRaw != null && String(serviceIdRaw).trim() !== ''
        ? String(serviceIdRaw).trim()
        : null;
    if (!serviceId) {
      throw new Error('Worker requires settings.serviceId (non-empty string)');
    }
    this.serviceId = serviceId;

    this.label =
      settings.label != null && String(settings.label).trim() !== ''
        ? String(settings.label).trim()
        : defaultLabelFromServiceId(serviceId);

    const {
      serviceId: _sid,
      label: _lbl,
      timeoutMs: timeoutMsRaw,
      ...remoteOpts
    } = settings;

    if (!remoteOpts.authority && !remoteOpts.host) {
      throw new Error(
        'Worker requires Remote options: settings.authority or settings.host'
      );
    }

    /** @type {number} */
    this.timeoutMs =
      typeof timeoutMsRaw === 'number' &&
      Number.isFinite(timeoutMsRaw) &&
      timeoutMsRaw > 0
        ? Math.max(500, Math.floor(timeoutMsRaw))
        : 14_000;

    /** @type {InstanceType<typeof Remote>} */
    this.remote = new Remote({
      ...remoteOpts,
      tlsServiceId: serviceId
    });
  }

  /**
   * @param {Promise<unknown>} promise
   * @returns {Promise<unknown>}
   */
  _withDeadline (promise) {
    let timer;
    const p = Promise.resolve(promise);
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `${this.serviceId}: request timed out after ${this.timeoutMs}ms`
          )
        );
      }, this.timeoutMs);
    });
    return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
  }

  /**
   * HTTP GET on the configured authority.
   * @param {string} path
   * @param {Object} [params]
   * @returns {Promise<unknown>}
   */
  get (path, params) {
    return this._withDeadline(this.remote._GET(path, params));
  }

  /**
   * HTTP POST on the configured authority.
   * @param {string} path
   * @param {unknown} [body]
   * @param {Object} [params]
   * @returns {Promise<unknown>}
   */
  post (path, body, params) {
    return this._withDeadline(this.remote._POST(path, body, params || {}));
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {Object} [params]
   * @returns {Promise<unknown>}
   */
  request (method, path, params) {
    return this._withDeadline(this.remote.request(method, path, params || {}));
  }
}

module.exports = Worker;
