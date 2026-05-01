'use strict';

const { fetchBtcUsdCandles } = require('./coinbaseExchangeCandles');
const { fetchBtcUsdOhlc } = require('./bitstampOhlc');
const { fetchXbtUsdOhlcRecent } = require('./krakenOhlc');

/** Supported Kraken `interval` query values (minutes). */
const KRAKEN_INTERVAL_MINUTES = new Set([
  1, 5, 15, 30, 60, 240, 1440, 10_080, 21_600
]);

/**
 * @param {number} intervalSec
 * @returns {number} Kraken `interval` minutes
 */
function intervalSecToKrakenMinutes (intervalSec) {
  const m = intervalSec / 60;
  if (!Number.isInteger(m) || !KRAKEN_INTERVAL_MINUTES.has(m)) {
    throw new Error(
      `Kraken OHLC does not support candle size ${intervalSec}s; use one of ` +
        `${[...KRAKEN_INTERVAL_MINUTES].map((x) => x * 60).join(', ')} (as intervalSec).`
    );
  }
  return m;
}

/**
 * Pull **closed** OHLC buckets from public venues. Timestamps are candle **open** (UTC, Unix seconds).
 *
 * - **coinbase** / **bitstamp:** arbitrary `[startSec, endSec)` when the venue supports `step`/`granularity`.
 * - **kraken:** at most ~721 recent buckets (see {@link fetchXbtUsdOhlcRecent}).
 *
 * @param {{
 *   startSec: number,
 *   endSec: number,
 *   intervalSec: number,
 *   providers?: Array<'coinbase'|'bitstamp'|'kraken'>,
 *   remoteByHost?: Partial<Record<string, import('@fabric/http/types/remote')>>,
 *   delayMs?: number
 * }} opts
 */
async function fetchMultiProviderHistory ({
  startSec,
  endSec,
  intervalSec,
  providers = ['coinbase', 'bitstamp'],
  remoteByHost = {},
  delayMs = 0
}) {
  const want = new Set(providers);
  const iv = Number(intervalSec);

  /** @type {{
   *   meta: { startSec: number, endSec: number, intervalSec: number },
   *   providers: Record<string, unknown[]>,
   *   kraken: null | Awaited<ReturnType<typeof fetchXbtUsdOhlcRecent>>
   * }} */
  const result = {
    meta: {
      startSec: Math.floor(Number(startSec)),
      endSec: Math.floor(Number(endSec)),
      intervalSec: Math.floor(iv)
    },
    providers: {},
    kraken: null
  };

  if (want.has('coinbase')) {
    result.providers.coinbase = await fetchBtcUsdCandles({
      remote: remoteByHost['api.exchange.coinbase.com'],
      startSec: result.meta.startSec,
      endSec: result.meta.endSec,
      granularitySec: iv,
      delayMs
    });
  }

  if (want.has('bitstamp')) {
    result.providers.bitstamp = await fetchBtcUsdOhlc({
      remote: remoteByHost['www.bitstamp.net'],
      startSec: result.meta.startSec,
      endSec: result.meta.endSec,
      stepSec: iv,
      delayMs
    });
  }

  if (want.has('kraken')) {
    const minutes = intervalSecToKrakenMinutes(iv);
    result.kraken = await fetchXbtUsdOhlcRecent({
      remote: remoteByHost['api.kraken.com'],
      intervalMinutes: minutes,
      startSec: result.meta.startSec,
      endSec: result.meta.endSec
    });
  }

  return result;
}

module.exports = {
  fetchBtcUsdCandles,
  fetchBtcUsdOhlc,
  fetchXbtUsdOhlcRecent,
  fetchMultiProviderHistory,
  intervalSecToKrakenMinutes,
  KRAKEN_INTERVAL_MINUTES
};
