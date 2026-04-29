'use strict';

/**
 * Quote timestamp in Unix ms for inverse-age weighting (server and UI use the same rule).
 * Order: `asOfMs`, then `created` (Date or parseable string).
 */
function quoteAsOfMs (q) {
  if (!q || typeof q !== 'object') return NaN;
  const direct = Number(/** @type {{ asOfMs?: unknown }} */ (q).asOfMs);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const created = /** @type {{ created?: unknown }} */ (q).created;
  if (created instanceof Date) {
    const t = created.getTime();
    return Number.isFinite(t) ? Math.round(t) : NaN;
  }
  if (created != null) {
    const t = Date.parse(String(created));
    return Number.isFinite(t) ? Math.round(t) : NaN;
  }
  return NaN;
}

module.exports = { quoteAsOfMs };
