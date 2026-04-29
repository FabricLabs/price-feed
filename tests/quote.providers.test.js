'use strict';

const assert = require('node:assert');

const BitPay = require('../services/providers/bitpay');
const Coinbase = require('../services/providers/coinbase');
const CoinGecko = require('../services/providers/coingecko');
const Kraken = require('../services/providers/kraken');
const Bitstamp = require('../services/providers/bitstamp');
const Gemini = require('../services/providers/gemini');
const Bitfinex = require('../services/providers/bitfinex');
const BinanceUS = require('../services/providers/binanceus');
const CoinMarketCap = require('../services/providers/coinmarketcap');

describe('quote providers', function () {
  this.timeout(8000);

  describe('BitPay', function () {
    it('returns quoted price and metadata for BTC/USD from BitPay-shaped response', async function () {
      const bitpay = new BitPay({ quoteCurrency: 'USD' });
      bitpay.http.get = async function (path) {
        assert.strictEqual(path, '/rates/BTC');
        return {
          data: [
            { code: 'EUR', rate: 50000 },
            { code: 'USD', rate: 87321.98 }
          ]
        };
      };

      const quote = await bitpay.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 87321.98);
      assert.ok(typeof quote.asOfMs === 'number' && quote.asOfMs > 0);
      assert.strictEqual(quote.asOfSource, 'fetch');
      assert.ok(Number.isFinite(quote.age));
      assert.ok(quote.created instanceof Date);
    });

    it('rejects unsupported symbols', async function () {
      const bitpay = new BitPay({});
      bitpay.http.get = async () => ({ data: [] });
      await assert.rejects(bitpay.getQuoteForSymbol('ETH'), /Only the "BTC"/);
    });
  });

  describe('Coinbase', function () {
    it('parses Exchange ticker price + venue time', async function () {
      const coinbase = new Coinbase({ currency: 'USD' });
      coinbase.http.get = async function (path) {
        assert.strictEqual(path, '/products/BTC-USD/ticker');
        return {
          price: '88234.567',
          time: '2021-06-01T00:00:00.000Z'
        };
      };

      const quote = await coinbase.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.ok(Math.abs(quote.price - 88234.567) < 1e-9);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, Date.parse('2021-06-01T00:00:00.000Z'));
      assert.ok(quote.created instanceof Date);
    });

    it('rejects unsupported symbols', async function () {
      const coinbase = new Coinbase({});
      coinbase.http.get = async () => ({ price: '1', time: '2020-01-01T00:00:00Z' });
      await assert.rejects(coinbase.getQuoteForSymbol('ETH'), /Only the "BTC"/);
    });
  });

  describe('CoinGecko', function () {
    it('parses simple/price for bitcoin.usd', async function () {
      const g = new CoinGecko({ currency: 'USD' });
      g.http.get = async function (path) {
        assert.ok(path.startsWith('/api/v3/simple/price'));
        assert.ok(path.includes('include_last_updated_at=true'));
        return {
          bitcoin: { usd: 70_001.25, last_updated_at: 1_700_000_000 }
        };
      };
      const quote = await g.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 70_001.25);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000 * 1000);
      assert.ok(quote.created instanceof Date);
    });
  });

  describe('Kraken', function () {
    it('parses Trades row (price + time)', async function () {
      const k = new Kraken({ currency: 'USD', tickerPair: 'XBTUSD' });
      k.http.get = async function (path) {
        assert.ok(path.includes('/0/public/Trades'));
        assert.ok(path.includes('count=1'));
        return {
          error: [],
          result: {
            XXBTZUSD: [['61234.5', '0.01', 1_700_000_000.123, 'b', 'l', '', 1]],
            last: 'x'
          }
        };
      };
      const quote = await k.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 61234.5);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_123);
    });

    it('surfaces Kraken error envelope', async function () {
      const k = new Kraken({});
      k.http.get = async () => ({ error: ['EQuery:Unknown asset pair'] });
      await assert.rejects(k.getQuoteForSymbol('BTC'), /EQuery:Unknown asset pair/);
    });
  });

  describe('Bitstamp', function () {
    it('parses v2 ticker last', async function () {
      const b = new Bitstamp({});
      b.http.get = async function (path) {
        assert.strictEqual(path, '/api/v2/ticker/btcusd/');
        return { last: '59999.01', timestamp: '1700000000' };
      };
      const quote = await b.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 59999.01);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_000);
    });
  });

  describe('Gemini', function () {
    it('parses pubticker last + timestampms', async function () {
      const g = new Gemini({});
      g.http.get = async function (path) {
        assert.strictEqual(path, '/v1/pubticker/BTCUSD');
        return {
          last: '63456.12',
          volume: { timestampms: '1700000000123' }
        };
      };
      const quote = await g.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 63456.12);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_123);
    });
  });

  describe('Bitfinex', function () {
    it('parses ticker array last price', async function () {
      const bfx = new Bitfinex({});
      bfx.http.get = async function (path) {
        assert.strictEqual(path, '/v2/ticker/tBTCUSD');
        return [63000, 1, 63010, 1, 10, 0.001, 63005.5, 100, 64000, 62000, 1700000000456];
      };
      const quote = await bfx.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 63005.5);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_456);
    });
  });

  describe('Binance.US', function () {
    it('parses 24h ticker lastPrice + closeTime', async function () {
      const bus = new BinanceUS({});
      bus.http.get = async function (path) {
        assert.strictEqual(path, '/api/v3/ticker/24hr?symbol=BTCUSD');
        return {
          lastPrice: '64123.45',
          closeTime: 1_700_000_000_789
        };
      };
      const quote = await bus.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64123.45);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_789);
    });
  });

  describe('CoinMarketCap', function () {
    it('maps latest quotes response to price and recent created time', async function () {
      const almostNow = new Date(Date.now() - 60_000).toISOString();
      const cmc = new CoinMarketCap({
        currency: 'USD',
        key: 'stub-key'
      });
      cmc.http.get = async function (path) {
        assert.ok(path.includes('/v1/cryptocurrency/quotes/latest'));
        assert.ok(path.includes('symbol=BTC'));
        assert.ok(path.includes('CMC_PRO_API_KEY=stub-key'));
        return {
          data: {
            BTC: {
              last_updated: almostNow,
              quote: {
                USD: {
                  price: 91_234.56
                }
              }
            }
          }
        };
      };

      const quote = await cmc.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 91_234.56);
      assert.ok(Number.isFinite(quote.age));
      assert.ok(quote.created instanceof Date);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.ok(typeof quote.asOfMs === 'number');

      const elapsed = Date.now() - quote.created.getTime();
      assert.ok(elapsed >= 50_000 && elapsed < 300_000, 'expected created within last few minutes');

      const bundle = await cmc.getAssetForSymbol('BTC');
      assert.strictEqual(bundle.quote.price, quote.price);
      assert.strictEqual(bundle.original.quote.USD.price, 91_234.56);
    });

    it('throws when payload has no data envelope', async function () {
      const cmc = new CoinMarketCap({ key: 'k' });
      cmc.http.get = async () => null;
      await assert.rejects(cmc.getQuoteForSymbol('BTC'), /CoinMarketCap/);
    });
  });
});
