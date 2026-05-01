'use strict';

/**
 * Normalized OHLC bucket — `periodStartSec` is the exchange candle **open** time (Unix seconds, UTC).
 * @typedef {object} HistoricalCandle
 * @property {string} provider
 * @property {number} periodStartSec
 * @property {number} intervalSec
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

/**
 * @param {HistoricalCandle[]} candles
 * @returns {HistoricalCandle[]}
 */
function sortByPeriodStart (candles) {
  const out = [].concat(candles || []);
  out.sort((a, b) => a.periodStartSec - b.periodStartSec);
  return out;
}

/**
 * Dedupe same provider + period (keeps first occurrence after sort).
 * @param {HistoricalCandle[]} candles
 * @returns {HistoricalCandle[]}
 */
function dedupeByProviderPeriod (candles) {
  const seen = new Set();
  const sorted = sortByPeriodStart(candles);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const k = `${c.provider}:${c.periodStartSec}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

module.exports = {
  sortByPeriodStart,
  dedupeByProviderPeriod
};
