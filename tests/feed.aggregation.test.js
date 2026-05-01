'use strict';

const assert = require('assert');
const Feed = require('../services/feed');

function stubQuoteService (calls) {
  return {
    async getQuoteForSymbol (symbol) {
      calls(symbol);
      return {
        age: Math.log(50),
        created: new Date(),
        currency: 'USD',
        price: 50_123.45
      };
    }
  };
}

describe('Feed aggregation (HTTP provider quotes)', function () {
  this.timeout(20_000);

  it('returns fromCache:true on repeat fetch within debounceMs', async () => {
    const bpCalls = [];
    const cbCalls = [];
    const bitpay = stubQuoteService(() => bpCalls.push(1));
    const coinbase = stubQuoteService(() => cbCalls.push(1));

    const feed = new Feed({
      sync: false,
      symbols: ['BTC'],
      sources: {
        bitpay: {},
        coinbase: {},
        coinmarketcap: {},
        coingecko: { enabled: false },
        kraken: { enabled: false },
        bitstamp: { enabled: false },
        utxoracle: { enabled: false }
      },
      aggregation: {
        debounceMs: 300_000,
        concurrency: {
          bitpay: 1,
          coinbase: 1,
          coingecko: 1,
          kraken: 1,
          bitstamp: 1,
          coinmarketcap: 1,
          utxoracle: 1
        }
      }
    });

    feed.bitpay = bitpay;
    feed.coinbase = coinbase;
    feed.services.bitpay = bitpay;
    feed.services.coinbase = coinbase;
    feed.cmc = { async getQuoteForSymbol () { throw new Error('no'); } };

    const r1 = await feed._fetchProviderQuotes('BTC');
    assert.strictEqual(r1.fulfilled.length, 2);
    assert.strictEqual(bpCalls.length, 1);
    assert.strictEqual(cbCalls.length, 1);
    assert.ok(
      r1.fulfilled.every((x) => x.fromCache !== true),
      'first fetch should be live (not broker cache)'
    );

    const r2 = await feed._fetchProviderQuotes('BTC');
    assert.strictEqual(r2.fulfilled.length, 2);
    assert.strictEqual(bpCalls.length, 1, 'BitPay supplier should hit cache');
    assert.strictEqual(cbCalls.length, 1, 'Coinbase supplier should hit cache');
    assert.ok(r2.fulfilled.every((x) => x.fromCache === true));
  });

  it('runs BitPay and Coinbase in parallel across providers', async () => {
    const order = [];

    const bitpay = {
      async getQuoteForSymbol () {
        await new Promise((r) => setTimeout(r, 40));
        order.push('bitpay-done');
        return { age: 1, currency: 'USD', price: 1 };
      }
    };

    const coinbase = {
      async getQuoteForSymbol () {
        await new Promise((r) => setTimeout(r, 40));
        order.push('coinbase-done');
        return { age: 1, currency: 'USD', price: 2 };
      }
    };

    const feed = new Feed({
      sync: false,
      symbols: ['BTC'],
      sources: {
        bitpay: {},
        coinbase: {},
        coinmarketcap: {},
        coingecko: { enabled: false },
        kraken: { enabled: false },
        bitstamp: { enabled: false },
        utxoracle: { enabled: false }
      },
      aggregation: {
        debounceMs: 0,
        concurrency: {
          bitpay: 1,
          coinbase: 1,
          coingecko: 1,
          kraken: 1,
          bitstamp: 1,
          coinmarketcap: 1,
          utxoracle: 1
        }
      }
    });
    feed.bitpay = bitpay;
    feed.coinbase = coinbase;
    feed.services.bitpay = bitpay;
    feed.services.coinbase = coinbase;
    feed.cmc = { async getQuoteForSymbol () { throw new Error('no'); } };

    const t0 = Date.now();
    await feed._fetchProviderQuotes('BTC');
    const elapsed = Date.now() - t0;

    assert.strictEqual(order.length, 2);
    assert.ok(
      order.includes('bitpay-done') && order.includes('coinbase-done'),
      `expected both providers, got ${order.join(',')}`
    );
    assert.ok(
      elapsed < 90,
      `BitPay and Coinbase should overlap in time (got ${elapsed}ms)`
    );
  });

  it('falls back to stale cached provider quotes when live refresh fails', async () => {
    let bitpayCalls = 0;
    let coinbaseCalls = 0;

    const bitpay = {
      async getQuoteForSymbol () {
        bitpayCalls++;
        if (bitpayCalls === 1) {
          const asOfMs = Date.now() - 5_000;
          return { age: 1, asOfMs, created: new Date(asOfMs), currency: 'USD', price: 60_000 };
        }
        throw new Error('bitpay upstream down');
      },
      async getDepthForSymbol () {
        return { depth: 1_000_000, bidDepth: 500_000, askDepth: 500_000, asOfMs: Date.now() };
      }
    };

    const coinbase = {
      async getQuoteForSymbol () {
        coinbaseCalls++;
        if (coinbaseCalls === 1) {
          const asOfMs = Date.now() - 7_000;
          return { age: 1, asOfMs, created: new Date(asOfMs), currency: 'USD', price: 60_100 };
        }
        throw new Error('coinbase upstream down');
      },
      async getDepthForSymbol () {
        return { depth: 2_000_000, bidDepth: 1_000_000, askDepth: 1_000_000, asOfMs: Date.now() };
      }
    };

    const feed = new Feed({
      sync: false,
      symbols: ['BTC'],
      sources: {
        bitpay: {},
        coinbase: {},
        coinmarketcap: {},
        coingecko: { enabled: false },
        kraken: { enabled: false },
        bitstamp: { enabled: false },
        gemini: { enabled: false },
        bitfinex: { enabled: false },
        binanceus: { enabled: false },
        utxoracle: { enabled: false }
      },
      aggregation: {
        debounceMs: 0,
        concurrency: {
          bitpay: 1,
          coinbase: 1,
          coingecko: 1,
          kraken: 1,
          bitstamp: 1,
          gemini: 1,
          bitfinex: 1,
          binanceus: 1,
          coinmarketcap: 1,
          utxoracle: 1
        }
      }
    });

    feed.bitpay = bitpay;
    feed.coinbase = coinbase;
    feed.services.bitpay = bitpay;
    feed.services.coinbase = coinbase;
    feed.cmc = { async getQuoteForSymbol () { throw new Error('no'); } };

    const first = await feed.getQuoteForSymbol('BTC');
    assert.ok(Number.isFinite(first.price), 'initial quote should compute');
    assert.strictEqual(first.sourceCount, 2);
    assert.ok(first.sources.every((s) => s.fromCache !== true));

    const second = await feed.getQuoteForSymbol('BTC');
    assert.ok(Number.isFinite(second.price), 'stale quote should still compute');
    assert.strictEqual(second.sourceCount, 2);
    assert.ok(second.sources.every((s) => s.fromCache === true));
  });
});
