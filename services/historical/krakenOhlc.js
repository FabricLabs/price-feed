'use strict';

/**
 * Kraken public OHLC — each row's leading `time` is the candle **open** (Unix seconds).
 * **Limitation:** the REST endpoint returns at most **721** buckets ending near "now";
 * deep history must use {@link fetchBtcUsdCandles} or {@link fetchBtcUsdOhlc} instead.
 * @see https://docs.kraken.com/rest/#tag/Market-Data/operation/getOHLCData
 */
const Remote = require('@fabric/http/types/remote');
const { dedupeByProviderPeriod } = require('../../types/historicalCandle');

const MAX_ROWS = 721;

/**
 * @param {object} opts
 * @param {Remote} [opts.remote]
 * @param {string} [opts.pair] default XBTUSD
 * @param {number} opts.intervalMinutes Kraken 1|5|15|30|60|240|1440|10080|21600
 * @param {number} [opts.startSec] filter inclusive after fetch
 * @param {number} [opts.endSec] filter exclusive on periodStartSec
 * @returns {Promise<{ candles: Array<import('../../types/historicalCandle.js')>, truncated: boolean, note: string }>}
 */
async function fetchXbtUsdOhlcRecent ({
  remote,
  pair = 'XBTUSD',
  intervalMinutes,
  startSec,
  endSec
}) {
  const iv = Number(intervalMinutes);
  if (!Number.isFinite(iv) || iv <= 0) {
    throw new Error('Kraken: intervalMinutes required.');
  }

  const r = remote || new Remote({
    authority: 'api.kraken.com',
    secure: true,
    port: 443
  });

  const enc = encodeURIComponent(pair);
  const data = await r._GET(`/0/public/OHLC?pair=${enc}&interval=${iv}`);

  if (data?.error?.length) {
    throw new Error(`Kraken: ${data.error.join('; ')}`);
  }

  const result = data?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('Kraken: empty OHLC result.');
  }

  const pairKey = Object.keys(result).filter((k) => k !== 'last')[0];
  const rows = pairKey && Array.isArray(result[pairKey])
    ? result[pairKey]
    : [];

  const intervalSec = iv * 60;
  const lo =
    startSec != null && Number.isFinite(Number(startSec))
      ? Math.floor(Number(startSec))
      : null;
  const hi =
    endSec != null && Number.isFinite(Number(endSec))
      ? Math.floor(Number(endSec))
      : null;

  /** @type {Array<import('../../types/historicalCandle.js')>} */
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 5) continue;
    const timeSec = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = row.length > 6 ? Number(row[6]) : undefined;
    if (!Number.isFinite(timeSec)) continue;
    if (lo != null && timeSec < lo) continue;
    if (hi != null && timeSec >= hi) continue;
    out.push({
      provider: 'kraken',
      periodStartSec: timeSec,
      intervalSec,
      open,
      high,
      low,
      close,
      ...(Number.isFinite(volume) ? { volume } : {})
    });
  }

  const deduped = dedupeByProviderPeriod(out);

  return {
    candles: deduped,
    truncated: rows.length >= MAX_ROWS,
    note:
      'Kraken OHLC returns at most ~721 buckets near the current time; use coinbase or bitstamp for long-range backfill.'
  };
}

module.exports = {
  fetchXbtUsdOhlcRecent,
  MAX_ROWS
};
