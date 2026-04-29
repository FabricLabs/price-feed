'use strict';

const assert = require('node:assert');
const {
  fetchBtcUsdCandles,
  ALLOWED_GRANULARITY
} = require('../services/historical/coinbaseExchangeCandles');
const { fetchBtcUsdOhlc } = require('../services/historical/bitstampOhlc');
const { fetchXbtUsdOhlcRecent } = require('../services/historical/krakenOhlc');
const { dedupeByProviderPeriod, sortByPeriodStart } = require('../types/historicalCandle');
const { fetchMultiProviderHistory, intervalSecToKrakenMinutes } =
  require('../services/historical');

describe('historical candles (exact period opens)', function () {
  it('dedupes by provider + periodStartSec', function () {
    const rows = dedupeByProviderPeriod([
      {
        provider: 'x',
        periodStartSec: 100,
        intervalSec: 60,
        open: 1,
        high: 1,
        low: 1,
        close: 1
      },
      {
        provider: 'x',
        periodStartSec: 100,
        intervalSec: 60,
        open: 2,
        high: 2,
        low: 2,
        close: 2
      },
      {
        provider: 'x',
        periodStartSec: 40,
        intervalSec: 60,
        open: 0,
        high: 0,
        low: 0,
        close: 0
      }
    ]);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].periodStartSec, 40);
    assert.strictEqual(rows[1].periodStartSec, 100);
    assert.strictEqual(rows[1].open, 1);
  });

  it('sortByPeriodStart orders ascending', function () {
    const s = sortByPeriodStart([
      { periodStartSec: 200 },
      { periodStartSec: 50 }
    ]);
    assert.strictEqual(s[0].periodStartSec, 50);
  });

  it('coinbaseExchange: chunks and parses [time, low, high, open, close]', async function () {
    const remote = {
      _calls: [],
      async _GET (p) {
        this._calls.push(p);
        if (p.includes('start=2021-01-01')) {
          return [
            [1609459200, 29000, 29100, 29050, 29090, 10],
            [1609545600, 28900, 29000, 29090, 28950, 11]
          ];
        }
        return [];
      }
    };

    const startSec = Date.parse('2021-01-01T00:00:00Z') / 1000;
    const endSec = Date.parse('2021-01-03T00:00:00Z') / 1000;

    const rows = await fetchBtcUsdCandles({
      remote,
      startSec,
      endSec,
      granularitySec: 86400
    });

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].provider, 'coinbase');
    assert.strictEqual(rows[0].periodStartSec, 1609459200);
    assert.strictEqual(rows[0].high, 29100);
    assert.strictEqual(rows[0].open, 29050);
    assert.ok(remote._calls.length >= 1);
    assert.ok(ALLOWED_GRANULARITY.has(86400));
  });

  it('bitstamp: parses data.data.ohlc', async function () {
    const remote = {
      async _GET () {
        return {
          data: {
            ohlc: [
              {
                timestamp: '1609459200',
                open: '1',
                high: '2',
                low: '0.5',
                close: '1.5',
                volume: '3'
              }
            ]
          }
        };
      }
    };

    const rows = await fetchBtcUsdOhlc({
      remote,
      startSec: 1609459200,
      endSec: 1609546000,
      stepSec: 3600
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].provider, 'bitstamp');
    assert.strictEqual(rows[0].periodStartSec, 1609459200);
    assert.strictEqual(rows[0].close, 1.5);
  });

  it('bitstamp: chunks wide ranges in time windows', async function () {
    const calls = [];
    const remote = {
      async _GET (p) {
        calls.push(p);
        if (p.includes('start=1000&') && p.includes('end=86401000')) {
          return {
            data: {
              ohlc: [
                {
                  timestamp: '1000',
                  open: '1',
                  high: '2',
                  low: '1',
                  close: '1.5',
                  volume: '1'
                }
              ]
            }
          };
        }
        if (p.includes('start=86401000')) {
          return {
            data: {
              ohlc: [
                {
                  timestamp: String(86401000),
                  open: '2',
                  high: '3',
                  low: '2',
                  close: '2.5',
                  volume: '1'
                }
              ]
            }
          };
        }
        return { data: { ohlc: [] } };
      }
    };

    const rows = await fetchBtcUsdOhlc({
      remote,
      startSec: 1000,
      endSec: 172801001,
      stepSec: 86_400,
      limit: 1000,
      delayMs: 0
    });
    assert.ok(calls.length >= 2);
    assert.ok(rows.length >= 2);
  });

  it('kraken OHLC maps pair array', async function () {
    const remote = {
      async _GET () {
        return {
          error: [],
          result: {
            XXBTZUSD: [
              [1609459200, '1', '2', '0.5', '1.5', '0', '100', 1]
            ],
            last: 1609459200
          }
        };
      }
    };

    const { candles, note } = await fetchXbtUsdOhlcRecent({
      remote,
      intervalMinutes: 1440
    });
    assert.strictEqual(candles.length, 1);
    assert.strictEqual(candles[0].provider, 'kraken');
    assert.strictEqual(candles[0].intervalSec, 86400);
    assert.ok(note.includes('721'));
  });

  it('intervalSecToKrakenMinutes rejects unsupported sizes', function () {
    assert.strictEqual(intervalSecToKrakenMinutes(3600), 60);
    assert.throws(() => intervalSecToKrakenMinutes(1234), /does not support/);
  });

  it('fetchMultiProviderHistory respects provider allowlist', async function () {
    const stubCb = {
      async _GET () {
        return [[1609459200, 1, 2, 1.5, 1.75, 0]];
      }
    };
    const h = await fetchMultiProviderHistory({
      startSec: 1609459200,
      endSec: 1609545600,
      intervalSec: 86400,
      providers: ['coinbase'],
      remoteByHost: { 'api.exchange.coinbase.com': stubCb }
    });
    assert.ok(Array.isArray(h.providers.coinbase));
    assert.strictEqual(h.providers.bitstamp, undefined);
    assert.strictEqual(h.kraken, null);
  });
});
