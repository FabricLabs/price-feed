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
  this.timeout(10_000);

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
});
