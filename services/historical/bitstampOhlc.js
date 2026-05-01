'use strict';

/**
 * Bitstamp v2 OHLC — `timestamp` is the candle **open** (string or number Unix seconds).
 * @see https://www.bitstamp.net/api/
 */
const Remote = require('@fabric/http/types/remote');
const { dedupeByProviderPeriod } = require('../../types/historicalCandle');

const DEFAULT_LIMIT = 1000;

async function sleepMs (ms) {
  const n = Number(ms);
  if (Number.isFinite(n) && n > 0) {
    await new Promise((resolve) => setTimeout(resolve, n));
  }
}

/**
 * @param {object} opts
 * @param {Remote} [opts.remote]
 * @param {number} opts.startSec inclusive
 * @param {number} opts.endSec exclusive on bucket start (we stop when next start >= endSec)
 * @param {number} opts.stepSec Bitstamp `step`: 60, 180, 300, 900, 1800, 3600, 86400
 * @param {number} [opts.limit]
 * @param {number} [opts.delayMs] wait between paginated requests
 * @returns {Promise<Array<import('../../types/historicalCandle.js')>>}
 */
async function fetchBtcUsdOhlc ({
  remote,
  startSec,
  endSec,
  stepSec,
  limit = DEFAULT_LIMIT,
  delayMs = 0
}) {
  const step = Math.floor(Number(stepSec));
  let a = Math.floor(Number(startSec));
  const b = Math.floor(Number(endSec));
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error('Bitstamp: invalid stepSec.');
  }
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    throw new Error('Bitstamp: invalid startSec/endSec.');
  }

  const r = remote || new Remote({
    authority: 'www.bitstamp.net',
    secure: true,
    port: 443
  });

  const lim = Math.min(Math.max(1, Math.floor(limit)), 1000);
  /** @type {Array<import('../../types/historicalCandle.js')>} */
  const out = [];

  /** Bitstamp caps responses (~1000); scan forward in fixed windows so early history is included. */
  const windowSec = step * lim;

  for (let t = a; t < b;) {
    if (t > a) await sleepMs(delayMs);
    const chunkEnd = Math.min(t + windowSec, b);
    const qs = `step=${step}&limit=${lim}&start=${t}&end=${chunkEnd}`;
    const data = await r._GET(`/api/v2/ohlc/btcusd/?${qs}`);
    const list = data?.data?.ohlc;
    if (!Array.isArray(list) || !list.length) {
      t = chunkEnd;
      continue;
    }

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const ts = Number(row.timestamp);
      if (!Number.isFinite(ts) || ts >= b) continue;
      if (ts < a) continue;
      const open = Number(row.open);
      const high = Number(row.high);
      const low = Number(row.low);
      const close = Number(row.close);
      const volume =
        row.volume != null ? Number(row.volume) : undefined;
      out.push({
        provider: 'bitstamp',
        periodStartSec: ts,
        intervalSec: step,
        open,
        high,
        low,
        close,
        ...(Number.isFinite(volume) ? { volume } : {})
      });
    }

    t = chunkEnd;
  }

  return dedupeByProviderPeriod(out);
}

module.exports = {
  fetchBtcUsdOhlc,
  DEFAULT_LIMIT
};
