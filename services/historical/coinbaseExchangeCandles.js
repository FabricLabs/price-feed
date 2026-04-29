'use strict';

/**
 * Coinbase **Exchange** public candles — each row uses the candle **open** time as Unix seconds.
 * @see https://docs.cloud.coinbase.com/exchange/docs#get-candles
 */
const Remote = require('@fabric/http/types/remote');
const { dedupeByProviderPeriod } = require('../../types/historicalCandle');

const MAX_CANDLES_PER_REQUEST = 300;

async function sleepMs (ms) {
  const n = Number(ms);
  if (Number.isFinite(n) && n > 0) {
    await new Promise((resolve) => setTimeout(resolve, n));
  }
}

/** @type {Set<number>} */
const ALLOWED_GRANULARITY = new Set([
  60, 300, 900, 3600, 21_600, 86_400
]);

/**
 * @param {object} opts
 * @param {Remote} opts.remote
 * @param {number} opts.startSec inclusive candle open lower bound (UTC)
 * @param {number} opts.endSec exclusive upper bound on candle **start** (same convention as API `end`)
 * @param {number} opts.granularitySec
 * @param {number} [opts.delayMs] wait between chunk requests (rate limits)
 * @returns {Promise<Array<import('../../types/historicalCandle.js')>>}
 */
async function fetchBtcUsdCandles ({
  remote,
  startSec,
  endSec,
  granularitySec,
  delayMs = 0
}) {
  const g = Number(granularitySec);
  if (!ALLOWED_GRANULARITY.has(g)) {
    throw new Error(
      `Coinbase: granularitySec must be one of ${[...ALLOWED_GRANULARITY].join(', ')}.`
    );
  }
  let a = Math.floor(Number(startSec));
  let b = Math.floor(Number(endSec));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    throw new Error('Coinbase: invalid startSec/endSec.');
  }

  const r = remote || new Remote({
    authority: 'api.exchange.coinbase.com',
    secure: true,
    port: 443
  });

  const windowSec = g * MAX_CANDLES_PER_REQUEST;
  /** @type {Array<import('../../types/historicalCandle.js')>} */
  const out = [];

  for (let t = a; t < b;) {
    if (t > a) await sleepMs(delayMs);
    const chunkEndSec = Math.min(t + windowSec, b);
    const startIso = new Date(t * 1000).toISOString();
    const endIso = new Date(chunkEndSec * 1000).toISOString();
    const qs = `granularity=${g}&start=${encodeURIComponent(
      startIso
    )}&end=${encodeURIComponent(endIso)}`;
    /** @type {number[][]} */
    const rows = await r._GET(`/products/BTC-USD/candles?${qs}`);
    if (!Array.isArray(rows)) {
      throw new Error('Coinbase: expected candles array.');
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row) || row.length < 5) continue;
      const timeSec = Number(row[0]);
      const low = Number(row[1]);
      const high = Number(row[2]);
      const open = Number(row[3]);
      const close = Number(row[4]);
      const volume = row.length > 5 ? Number(row[5]) : undefined;
      if (!Number.isFinite(timeSec)) continue;
      if (timeSec < a || timeSec >= b) continue;
      out.push({
        provider: 'coinbase',
        periodStartSec: timeSec,
        intervalSec: g,
        open,
        high,
        low,
        close,
        ...(Number.isFinite(volume) ? { volume } : {})
      });
    }

    t = chunkEndSec;
  }

  return dedupeByProviderPeriod(out);
}

module.exports = {
  fetchBtcUsdCandles,
  MAX_CANDLES_PER_REQUEST,
  ALLOWED_GRANULARITY
};
