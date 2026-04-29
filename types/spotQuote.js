'use strict';

/**
 * Inverse-age weighting from an **as-of** wall time (venue trade time or best-known fetch instant), ms since epoch.
 * @param {number} asOfMs
 * @param {number} [nowMs]
 */
function ageLogFromAsOfMs (asOfMs, nowMs = Date.now()) {
  const t = Number(asOfMs);
  if (!Number.isFinite(t)) {
    return Math.log(1);
  }
  return Math.log(Math.max(1, nowMs - t));
}

/**
 * Normalized spot quote: integer `asOfMs`, ISO `created`, and `age` from {@link ageLogFromAsOfMs}.
 *
 * @param {{
 *   price: number,
 *   currency: string,
 *   asOfMs: number,
 *   asOfSource: 'venue'|'fetch'|'chain'
 * }} p
 * @returns {{
 *   price: number,
 *   currency: string,
 *   asOfMs: number,
 *   asOfSource: string,
 *   created: Date,
 *   age: number
 * }}
 */
function normalizeSpotQuote (p) {
  const asOfMs = Math.round(Number(p.asOfMs));
  if (!Number.isFinite(asOfMs) || asOfMs <= 0) {
    throw new Error('normalizeSpotQuote: invalid asOfMs');
  }
  const price = Number(p.price);
  if (!Number.isFinite(price)) {
    throw new Error('normalizeSpotQuote: invalid price');
  }
  const cur = String(p.currency || 'USD').trim() || 'USD';
  const src = p.asOfSource;
  const asOfSource =
    src === 'venue' || src === 'chain' ? src : 'fetch';

  return {
    price,
    currency: cur,
    asOfMs,
    asOfSource,
    created: new Date(asOfMs),
    age: ageLogFromAsOfMs(asOfMs)
  };
}

module.exports = {
  normalizeSpotQuote,
  ageLogFromAsOfMs
};
