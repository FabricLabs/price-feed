'use strict';

const assert = require('assert');
const net = require('node:net');
const Feed = require('../services/feed');

function getFreeListenPort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : null;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('@portal/feed', function () {
  describe('Feed', function () {
    this.timeout(15000);

    it('is an instance of a function', () => {
      assert.equal(Feed instanceof Function, true);
    });

    it('merges partial sources so omitted providers keep defaults (including utxoracle)', () => {
      const feed = new Feed({
        sources: {
          bitpay: {},
          coinmarketcap: { key: 'k' },
          utxoracle: {
            enabled: true,
            windowBlocks: 99
          }
        }
      });

      assert.deepStrictEqual(feed.settings.sources.bitpay, {});
      assert.strictEqual(feed.settings.sources.coinmarketcap?.key, 'k');
      assert.deepStrictEqual(feed.settings.sources.coinbase, {});
      assert.strictEqual(feed.settings.sources.utxoracle.enabled, true);
      assert.strictEqual(feed.settings.sources.utxoracle.windowBlocks, 99);
      assert.strictEqual(feed.utxoracle.settings.enabled, true);
      assert.strictEqual(feed.utxoracle.settings.windowBlocks, 99);
    });

    it('does not overwrite lastTls with rejected TLS telemetry', () => {
      const feed = new Feed({ sync: false });
      const good = {
        authorized: true,
        protocol: 'TLSv1.3',
        peer: { issuer: { O: 'Test CA' } }
      };
      feed._providerTelemetry.bitpay.lastTls = {
        ...good,
        url: 'https://bitpay.com/x',
        capturedAt: 1
      };
      feed._tlsTelemetryBound('bitpay', 'https://bitpay.com/', {
        authorized: false,
        rejected: true,
        authorizationError: 'CERT_HAS_EXPIRED'
      });
      assert.strictEqual(feed._providerTelemetry.bitpay.lastTls.capturedAt, 1);
      assert.strictEqual(feed._providerTelemetry.bitpay.lastTls.authorized, true);
    });

    it('records lastTls when TLS telemetry is authorized', () => {
      const feed = new Feed({ sync: false });
      feed._tlsTelemetryBound('bitpay', 'https://bitpay.com/rates/BTC', {
        authorized: true,
        authorizationError: null,
        protocol: 'TLSv1.3',
        peer: { issuer: { CN: "Let's Encrypt" } }
      });
      const tls = feed._providerTelemetry.bitpay.lastTls;
      assert.ok(tls && typeof tls === 'object');
      assert.strictEqual(tls.authorized, true);
      assert.strictEqual(tls.url, 'https://bitpay.com/rates/BTC');
      assert.ok(typeof tls.capturedAt === 'number');
    });

    it('merges top-level bitcoin settings into UTXOracle', () => {
      const feed = new Feed({
        bitcoin: { network: 'regtest', managed: true },
        sources: {
          utxoracle: {
            enabled: true,
            bitcoin: { rpcport: 18443 }
          }
        }
      });

      assert.strictEqual(feed.utxoracle._bitcoin.settings.network, 'regtest');
      assert.strictEqual(feed.utxoracle._bitcoin.settings.managed, true);
      assert.strictEqual(Number(feed.utxoracle._bitcoin.settings.rpcport), 18443);
      assert.strictEqual(feed.bitcoin, feed.utxoracle._bitcoin);
    });

    it('weighted price includes every provider with a valid quote (UTXOracle + exchanges)', async () => {
      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          bitpay: {},
          coinbase: {},
          utxoracle: { enabled: true },
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        }
      });

      feed.bitpay.http.get = async (path) => {
        if (path === '/rates/BTC') {
          return { data: [{ code: 'USD', rate: 60_000 }] };
        }
        if (path === '/rates') return { data: [{ code: 'USD', rate: 1 }] };
        return { data: [] };
      };

      feed.coinbase.http.get = async () => ({
        price: '62000',
        time: '2020-01-15T12:00:01.000Z'
      });

      feed.utxoracle.isChainReadyForAggregation = async () => true;

      feed.utxoracle.getQuoteForSymbol = async (sym) => {
        assert.strictEqual(sym, 'BTC');
        const asOfMs = Date.parse('2020-01-15T12:00:02.000Z');
        return {
          age: 1,
          currency: 'USD',
          price: 61_000,
          created: new Date(asOfMs),
          asOfMs,
          asOfSource: 'chain'
        };
      };

      const q = await feed.getQuoteForSymbol('BTC');
      assert.strictEqual(q.sourceCount, 3);
      assert.strictEqual(q.sources.length, 3);
      const providers = q.sources.map((s) => s.provider).sort();
      assert.deepStrictEqual(providers, ['bitpay', 'coinbase', 'utxoracle']);

      assert.ok(Number.isFinite(q.price));
      const prices = q.sources
        .map((s) => Number(s.price))
        .filter((p) => Number.isFinite(p));
      assert.strictEqual(prices.length, 3);
      assert.ok(q.price <= Math.max(...prices) + 0.01);
      assert.ok(q.price >= Math.min(...prices) - 0.01);

      for (const s of q.sources) {
        assert.ok(
          typeof s.asOfMs === 'number' && Number.isFinite(s.asOfMs),
          `${s.provider} should expose asOfMs`
        );
      }
    });

    it('omits UTXOracle from weighted spot until chain is ready for aggregation', async () => {
      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          bitpay: {},
          coinbase: {},
          utxoracle: { enabled: true },
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        }
      });

      feed.bitpay.http.get = async (path) => {
        if (path === '/rates/BTC') {
          return { data: [{ code: 'USD', rate: 60_000 }] };
        }
        if (path === '/rates') return { data: [{ code: 'USD', rate: 1 }] };
        return { data: [] };
      };

      feed.coinbase.http.get = async () => ({
        price: '62000',
        time: '2020-01-15T12:00:01.000Z'
      });

      feed.utxoracle.isChainReadyForAggregation = async () => false;
      feed.utxoracle.getQuoteForSymbol = async () => ({
        price: 58_000,
        currency: 'USD',
        age: 1,
        asOfMs: Date.now() - 60_000,
        created: new Date().toISOString()
      });

      const q = await feed.getQuoteForSymbol('BTC');
      assert.strictEqual(q.sourceCount, 2);
      assert.deepStrictEqual(
        q.sources.map((s) => s.provider).sort(),
        ['bitpay', 'coinbase', 'utxoracle']
      );
      const utx = q.sources.find((s) => s.provider === 'utxoracle');
      assert.ok(utx);
      assert.strictEqual(utx.excludedFromSpot, true);
      assert.strictEqual(Number(utx.price), 58_000);
    });

    it('drops hung HTTP workers after Worker timeout so quotes still return', async () => {
      const feed = new Feed({
        currency: 'BTC',
        sync: false,
        sources: {
          bitpay: { timeoutMs: 400 },
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        },
        aggregation: {
          debounceMs: 60_000
        }
      });

      feed.bitpay.http.remote._GET = async () =>
        await new Promise(() => {
          /* never resolves */
        });
      feed.coinbase.http.get = async () => ({
        price: '51000',
        time: '2020-01-15T12:00:00.000Z'
      });

      const started = Date.now();
      const q = await feed.getQuoteForSymbol('BTC');
      assert.ok(
        Date.now() - started < 3500,
        'aggregate should not wait forever on one provider'
      );
      assert.ok(q.sources.some((s) => s.provider === 'coinbase'));
      assert.ok(!q.sources.some((s) => s.provider === 'bitpay'));
      assert.ok(
        String(feed._providerTelemetry.bitpay.lastError || '').includes('timed out'),
        'BitPay error should mention timeout'
      );
    });

    it('applies 429 backoff and avoids hammering the provider until nextAttemptAt', async () => {
      const feed = new Feed({
        currency: 'BTC',
        sync: false,
        sources: {
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        },
        aggregation: { debounceMs: 120_000 }
      });

      let bitpayCalls = 0;
      feed.bitpay.http.get = async (path) => {
        bitpayCalls++;
        if (bitpayCalls === 1) {
          throw new Error('BitPay: Rate limited [429]');
        }
        if (path === '/rates/BTC') return { data: [{ code: 'USD', rate: 50_000 }] };
        if (path === '/rates') return { data: [{ code: 'USD', rate: 1 }] };
        return { data: [] };
      };
      feed.coinbase.http.get = async () => ({
        price: '51000',
        time: '2020-01-15T12:00:00.000Z'
      });

      const q1 = await feed.getQuoteForSymbol('BTC');
      const tel = feed._providerTelemetry.bitpay;
      assert.ok(
        tel.nextAttemptAt && tel.nextAttemptAt > Date.now(),
        'nextAttemptAt set after 429'
      );
      assert.strictEqual(tel.rateLimitStreak, 1);
      assert.ok(q1.sources.some((s) => s.provider === 'coinbase'));
      assert.ok(!q1.sources.some((s) => s.provider === 'bitpay'));

      const before = bitpayCalls;
      await feed.getQuoteForSymbol('BTC');
      assert.strictEqual(
        bitpayCalls,
        before,
        'BitPay HTTP not called while in rate-limit window without cache'
      );

      tel.nextAttemptAt = Date.now() - 1;
      const q3 = await feed.getQuoteForSymbol('BTC');
      assert.ok(bitpayCalls > before, 'BitPay retries after window');
      assert.strictEqual(feed._providerTelemetry.bitpay.rateLimitStreak, 0);
      assert.ok(q3.sources.some((s) => s.provider === 'bitpay'));
    });

    it('only prices BTC (rejects other symbols)', async () => {
      const feed = new Feed({ sync: false });
      await assert.rejects(
        feed.getQuoteForSymbol('LTC'),
        /Only BTC is supported/
      );
      await assert.rejects(
        feed.getAssetForSymbol('ETH'),
        /Only BTC is supported/
      );
    });

    it('ignores configured symbols list (BTC only)', () => {
      const feed = new Feed({ symbols: ['LTC', 'ETH'] });
      assert.deepStrictEqual(feed.settings.symbols, ['BTC']);
    });

    it('does not enable CoinMarketCap for placeholder API keys', () => {
      const feed = new Feed({
        sync: false,
        sources: { coinmarketcap: { key: 'YOUR_COINMARKETCAP_API_KEY' } }
      });
      assert.strictEqual(feed._providerEnabled('coinmarketcap'), false);
    });

    it('can be instantiated with no input', () => {
      const feed = new Feed();
      assert.ok(feed);
    });

    it('can be started with no input', async () => {
      const port = await getFreeListenPort();
      const feed = new Feed({
        sync: false,
        http: { bind: '127.0.0.1', port, host: 'localhost', secure: false },
      });
      await feed.start();
      await feed.stop();
      assert.ok(feed);
    });

    it('generates a sane quote', async () => {
      const CURRENCY = 'BTC';
      const feed = new Feed({
        currency: CURRENCY,
        symbols: ['BTC'],
        sources: {
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        }
      });

      feed.bitpay.http.get = async (path) => {
        if (path === '/rates/BTC') {
          return {
            data: [{ code: 'USD', rate: 65_432.1 }]
          };
        }
        if (path === '/rates') {
          return { data: [{ code: 'USD', rate: 1 }] };
        }
        return { data: [] };
      };

      feed.coinbase.http.get = async () => ({
        price: '65432.9',
        time: '2020-01-15T12:00:00.000Z'
      });

      const report = await feed.generateReport();

      assert.ok(report);
      assert.ok(report.attestation);
      assert.ok(report.values);
      assert.ok(report.values[CURRENCY]);

      assert.strictEqual(report.currency, CURRENCY);
    });

    it('can get a quote without configuration', async () => {
      const feed = new Feed({
        sources: {
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        }
      });
      const report = await feed.generateReport();
      assert.ok(report);
    });
  });
});
