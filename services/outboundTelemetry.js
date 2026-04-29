'use strict';

/** @type {((serviceId: string, url: string, tls: Record<string, unknown>) => void) | null} */
let tlsTelemetryHook = null;

/**
 * Register a callback invoked after each outbound HTTPS response with TLS peer metadata.
 * Pass `null` to clear (e.g. on Feed stop).
 * @param {((serviceId: string, url: string, tls: Record<string, unknown>) => void) | null} fn
 */
function setTlsTelemetryHook (fn) {
  tlsTelemetryHook =
    typeof fn === 'function'
      ? fn
      : null;
}

/**
 * @param {string} serviceId
 * @param {string} url
 * @param {Record<string, unknown>} tls
 */
function emitTlsTelemetry (serviceId, url, tls) {
  if (!tlsTelemetryHook) return;
  try {
    tlsTelemetryHook(String(serviceId || ''), String(url || ''), tls);
  } catch {
    /* best-effort telemetry */
  }
}

module.exports = {
  setTlsTelemetryHook,
  emitTlsTelemetry
};
