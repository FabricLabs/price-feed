'use strict';

const assert = require('node:assert');

const BitPay = require('../services/providers/bitpay');
const Coinbase = require('../services/providers/coinbase');
const CoinGecko = require('../services/providers/coingecko');
const Kraken = require('../services/providers/kraken');
const Bitstamp = require('../services/providers/bitstamp');
const Gemini = require('../services/providers/gemini');
const Bitfinex = require('../services/providers/bitfinex');
const Binance = require('../services/providers/binance');
const BinanceUS = require('../services/providers/binanceus');
const OKX = require('../services/providers/okx');
const Bybit = require('../services/providers/bybit');
const KuCoin = require('../services/providers/kucoin');
const GateIO = require('../services/providers/gateio');
const MEXC = require('../services/providers/mexc');
const Bitget = require('../services/providers/bitget');
const HTX = require('../services/providers/htx');
const CoinEx = require('../services/providers/coinex');
const CEXIO = require('../services/providers/cexio');
const Upbit = require('../services/providers/upbit');
const Bitso = require('../services/providers/bitso');
const Phemex = require('../services/providers/phemex');
const Bitvavo = require('../services/providers/bitvavo');
const CryptoCom = require('../services/providers/cryptocom');
const WhiteBIT = require('../services/providers/whitebit');
const LBank = require('../services/providers/lbank');
const DigiFinex = require('../services/providers/digifinex');
const AscendEX = require('../services/providers/ascendex');
const BTSE = require('../services/providers/btse');
const BitMart = require('../services/providers/bitmart');
const BingX = require('../services/providers/bingx');
const Bitrue = require('../services/providers/bitrue');
const Poloniex = require('../services/providers/poloniex');
const Deribit = require('../services/providers/deribit');
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

    it('parses orderbook bids/asks', async function () {
      const coinbase = new Coinbase({});
      coinbase.http.get = async function (path) {
        assert.strictEqual(path, '/products/BTC-USD/book?level=2');
        return {
          bids: [['62000', '1.5']],
          asks: [['62010', '2.25']]
        };
      };
      const book = await coinbase.getOrderBookForSymbol('BTC');
      assert.strictEqual(book.bids.length, 1);
      assert.strictEqual(book.asks.length, 1);
      assert.strictEqual(book.bids[0][0], 62000);
      assert.strictEqual(book.asks[0][1], 2.25);
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

  describe('Binance', function () {
    it('parses 24h ticker lastPrice + closeTime', async function () {
      const b = new Binance({});
      b.http.get = async function (path) {
        assert.strictEqual(path, '/api/v3/ticker/24hr?symbol=BTCUSDT');
        return {
          lastPrice: '64111.22',
          closeTime: 1_700_000_000_321
        };
      };
      const quote = await b.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64111.22);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_321);
    });

    it('parses depth orderbook levels', async function () {
      const b = new Binance({});
      b.http.get = async function (path) {
        assert.strictEqual(path, '/api/v3/depth?symbol=BTCUSDT&limit=20');
        return {
          bids: [['64000', '1.2']],
          asks: [['64010', '1.4']],
          E: 1_700_000_000_555
        };
      };
      const book = await b.getOrderBookForSymbol('BTC');
      assert.strictEqual(book.bids[0][0], 64000);
      assert.strictEqual(book.asks[0][1], 1.4);
      assert.strictEqual(book.asOfMs, 1_700_000_000_555);
    });
  });

  describe('OKX', function () {
    it('parses market ticker last + ts', async function () {
      const okx = new OKX({});
      okx.http.get = async function (path) {
        assert.strictEqual(path, '/api/v5/market/ticker?instId=BTC-USDT');
        return {
          data: [{ last: '64200.01', ts: '1700000000654' }]
        };
      };
      const quote = await okx.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64200.01);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_654);
    });
  });

  describe('Bybit', function () {
    it('parses v5 ticker lastPrice + time', async function () {
      const bybit = new Bybit({});
      bybit.http.get = async function (path) {
        assert.strictEqual(path, '/v5/market/tickers?category=spot&symbol=BTCUSDT');
        return {
          retCode: 0,
          retMsg: 'OK',
          time: 1_700_000_000_777,
          result: { list: [{ lastPrice: '64333.44' }] }
        };
      };
      const quote = await bybit.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64333.44);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_777);
    });
  });

  describe('KuCoin', function () {
    it('parses level1 ticker price + time', async function () {
      const kucoin = new KuCoin({});
      kucoin.http.get = async function (path) {
        assert.strictEqual(path, '/api/v1/market/orderbook/level1?symbol=BTC-USDT');
        return {
          code: '200000',
          data: {
            price: '64444.55',
            time: 1_700_000_000_888
          }
        };
      };
      const quote = await kucoin.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64444.55);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_888);
    });
  });

  describe('Gate.io', function () {
    it('parses spot ticker array last', async function () {
      const gateio = new GateIO({});
      gateio.http.get = async function (path) {
        assert.strictEqual(path, '/api/v4/spot/tickers?currency_pair=BTC_USDT');
        return [{ last: '64555.66' }];
      };
      const quote = await gateio.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64555.66);
      assert.strictEqual(quote.asOfSource, 'fetch');
      assert.ok(typeof quote.asOfMs === 'number');
    });
  });

  describe('MEXC', function () {
    it('parses 24h ticker lastPrice + closeTime', async function () {
      const mexc = new MEXC({});
      mexc.http.get = async function (path) {
        assert.strictEqual(path, '/api/v3/ticker/24hr?symbol=BTCUSDT');
        return {
          lastPrice: '64666.11',
          closeTime: 1_700_000_000_222
        };
      };
      const quote = await mexc.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64666.11);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_222);
    });
  });

  describe('Bitget', function () {
    it('parses spot tickers lastPr + ts', async function () {
      const bitget = new Bitget({});
      bitget.http.get = async function (path) {
        assert.strictEqual(path, '/api/v2/spot/market/tickers?symbol=BTCUSDT');
        return {
          code: '00000',
          data: [{ lastPr: '64777.22', ts: '1700000000333' }]
        };
      };
      const quote = await bitget.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64777.22);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_333);
    });
  });

  describe('HTX', function () {
    it('parses merged ticker close + ts', async function () {
      const htx = new HTX({});
      htx.http.get = async function (path) {
        assert.strictEqual(path, '/market/detail/merged?symbol=btcusdt');
        return {
          status: 'ok',
          ts: 1_700_000_000_444,
          tick: { close: '64888.33' }
        };
      };
      const quote = await htx.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64888.33);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_444);
    });
  });

  describe('CoinEx', function () {
    it('parses market ticker last + date', async function () {
      const coinex = new CoinEx({});
      coinex.http.get = async function (path) {
        assert.strictEqual(path, '/v1/market/ticker?market=BTCUSDT');
        return {
          code: 0,
          data: {
            date: 1_700_000_000,
            ticker: { last: '64999.44' }
          }
        };
      };
      const quote = await coinex.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 64999.44);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_000_000);
    });
  });

  describe('CEX.IO', function () {
    it('parses ticker last + timestamp', async function () {
      const cexio = new CEXIO({});
      cexio.http.get = async function (path) {
        assert.strictEqual(path, '/api/ticker/BTC/USD');
        return {
          last: '65111.55',
          timestamp: '1700000001'
        };
      };
      const quote = await cexio.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65111.55);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_001_000);
    });
  });

  describe('Upbit', function () {
    it('parses ticker trade_price + timestamp', async function () {
      const upbit = new Upbit({});
      upbit.http.get = async function (path) {
        assert.strictEqual(path, '/v1/ticker?markets=USDT-BTC');
        return [{ trade_price: '65222.66', timestamp: 1_700_000_001_111 }];
      };
      const quote = await upbit.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65222.66);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_001_111);
    });
  });

  describe('Bitso', function () {
    it('parses payload.last + payload.created_at', async function () {
      const bitso = new Bitso({});
      bitso.http.get = async function (path) {
        assert.strictEqual(path, '/v3/ticker/?book=btc_usd');
        return {
          payload: {
            last: '65333.77',
            created_at: '2024-01-01T00:00:00.000Z'
          }
        };
      };
      const quote = await bitso.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65333.77);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, Date.parse('2024-01-01T00:00:00.000Z'));
    });
  });

  describe('Phemex', function () {
    it('parses result.lastEp + timestamp', async function () {
      const phemex = new Phemex({});
      phemex.http.get = async function (path) {
        assert.strictEqual(path, '/md/v2/ticker/24hr?symbol=BTCUSDT');
        return {
          result: {
            lastEp: 654445500,
            timestamp: 1_700_000_001_222
          }
        };
      };
      const quote = await phemex.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65444.55);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_001_222);
    });
  });

  describe('Bitvavo', function () {
    it('parses ticker price for BTC-EUR market', async function () {
      const bitvavo = new Bitvavo({});
      bitvavo.http.get = async function (path) {
        assert.strictEqual(path, '/v2/ticker/price?market=BTC-EUR');
        return { market: 'BTC-EUR', price: '65555.88' };
      };
      const quote = await bitvavo.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'EUR');
      assert.strictEqual(quote.price, 65555.88);
      assert.strictEqual(quote.asOfSource, 'fetch');
      assert.ok(typeof quote.asOfMs === 'number');
    });
  });

  describe('Crypto.com', function () {
    it('parses public ticker price from result.data', async function () {
      const cryptocom = new CryptoCom({});
      cryptocom.http.get = async function (path) {
        assert.strictEqual(path, '/v2/public/get-ticker?instrument_name=BTC_USDT');
        return {
          result: {
            t: 1_700_000_001_333,
            data: { a: '65666.99' }
          }
        };
      };
      const quote = await cryptocom.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65666.99);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_001_333);
    });
  });

  describe('WhiteBIT', function () {
    it('parses public ticker last_price', async function () {
      const whitebit = new WhiteBIT({});
      whitebit.http.get = async function (path) {
        assert.strictEqual(path, '/api/v4/public/ticker?market=BTC_USDT');
        return { last_price: '65777.11' };
      };
      const quote = await whitebit.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65777.11);
    });
  });

  describe('LBank', function () {
    it('parses ticker latest value', async function () {
      const lbank = new LBank({});
      lbank.http.get = async function (path) {
        assert.strictEqual(path, '/v2/ticker/24hr.do?symbol=btc_usdt');
        return { data: [{ ticker: { latest: '65888.22' } }] };
      };
      const quote = await lbank.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65888.22);
    });
  });

  describe('DigiFinex', function () {
    it('parses ticker price value', async function () {
      const digifinex = new DigiFinex({});
      digifinex.http.get = async function (path) {
        assert.strictEqual(path, '/v3/ticker?symbol=btc_usdt');
        return { ticker: [{ price: '65999.33' }] };
      };
      const quote = await digifinex.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 65999.33);
    });
  });

  describe('AscendEX', function () {
    it('parses ticker close + ts', async function () {
      const ascendex = new AscendEX({});
      ascendex.http.get = async function (path) {
        assert.strictEqual(path, '/api/pro/v1/ticker?symbol=BTC/USDT');
        return { data: { close: '66011.44', ts: 1_700_000_002_001 } };
      };
      const quote = await ascendex.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66011.44);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_002_001);
    });
  });

  describe('BTSE', function () {
    it('parses market summary last + timestamp', async function () {
      const btse = new BTSE({});
      btse.http.get = async function (path) {
        assert.strictEqual(path, '/spot/api/v3.2/market_summary');
        return [{ symbol: 'BTC-USD', last: '66122.55', timestamp: 1_700_000_002_002 }];
      };
      const quote = await btse.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66122.55);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_002_002);
    });
  });

  describe('BitMart', function () {
    it('parses ticker lastPrice', async function () {
      const bitmart = new BitMart({});
      bitmart.http.get = async function (path) {
        assert.strictEqual(path, '/spot/quotation/v3/tickers?symbol=BTC_USDT');
        return { data: { tickers: [{ lastPrice: '66222.66' }] } };
      };
      const quote = await bitmart.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66222.66);
    });
  });

  describe('BingX', function () {
    it('parses ticker lastPrice + closeTime', async function () {
      const bingx = new BingX({});
      bingx.http.get = async function (path) {
        assert.strictEqual(path, '/openApi/spot/v1/ticker/24hr?symbol=BTC-USDT');
        return { data: { lastPrice: '66333.77', closeTime: 1_700_000_003_111 } };
      };
      const quote = await bingx.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66333.77);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_003_111);
    });
  });

  describe('Bitrue', function () {
    it('parses 24hr ticker lastPrice + closeTime', async function () {
      const bitrue = new Bitrue({});
      bitrue.http.get = async function (path) {
        assert.strictEqual(path, '/api/v1/ticker/24hr?symbol=BTCUSDT');
        return { lastPrice: '66444.88', closeTime: 1_700_000_003_112 };
      };
      const quote = await bitrue.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66444.88);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_003_112);
    });
  });

  describe('Poloniex', function () {
    it('parses ticker24h close + closeTime', async function () {
      const poloniex = new Poloniex({});
      poloniex.http.get = async function (path) {
        assert.strictEqual(path, '/markets/BTC_USDT/ticker24h');
        return { close: '66555.99', closeTime: 1_700_000_003_113 };
      };
      const quote = await poloniex.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66555.99);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_003_113);
    });
  });

  describe('Deribit', function () {
    it('parses public ticker last_price + timestamp', async function () {
      const deribit = new Deribit({});
      deribit.http.get = async function (path) {
        assert.strictEqual(path, '/api/v2/public/ticker?instrument_name=BTC-USD');
        return { result: { last_price: '66666.11', timestamp: 1_700_000_003_114 } };
      };
      const quote = await deribit.getQuoteForSymbol('BTC');
      assert.strictEqual(quote.currency, 'USD');
      assert.strictEqual(quote.price, 66666.11);
      assert.strictEqual(quote.asOfSource, 'venue');
      assert.strictEqual(quote.asOfMs, 1_700_000_003_114);
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
