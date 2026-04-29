'use strict';

const assert = require('assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Feed = require('../services/feed');

function getFreeListenPort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr !== null ? addr.port : null;
      server.close((err) => (err ? reject(err) : resolve(p)));
    });
  });
}

async function fetchReportJson (port) {
  const res = await fetch(`http://127.0.0.1:${port}/feed/report`);
  assert.strictEqual(res.ok, true, `${res.status} ${res.statusText}`);
  return /** @type {Record<string, unknown>} */ (await res.json());
}

describe('Feed HTTP (/feed/report)', function () {
  this.timeout(20_000);

  it('serves aggregated values with provenance and persistedSnapshot', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-'));

    try {
      const persistPath = path.join(tmpRoot, 'lvl');

      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        },
        persist: {
          path: persistPath,
          maxHistoryRows: 32
        },
        sync: false,
        aggregation: {
          debounceMs: 12_000
        },
        // Fabric HTTPServer uses `host` (or `interface`) for listen(), not `bind`.
        // Match fetch URL to avoid ::1 vs 127.0.0.1 ECONNREFUSED on some hosts.
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      feed.bitpay.http.get = async (p) => {
        if (p === '/rates/BTC') return { data: [{ code: 'USD', rate: 60_111 }] };
        if (p === '/rates') return { data: [{ code: 'USD', rate: 1 }] };
        return { data: [] };
      };

      feed.coinbase.http.get = async () => ({
        price: '60222.2',
        time: '2020-01-15T12:00:00.000Z'
      });

      await feed.start();

      const report = await fetchReportJson(Number(port));

      assert.strictEqual(report.currency, 'BTC');
      assert.ok(report.values && typeof report.values === 'object');

      const values = /** @type {Record<string, unknown>} */ (report.values);
      const B = /** @type {Record<string, unknown>} */ (values.BTC);

      assert.ok(B && typeof B.price === 'number');
      assert.ok(typeof B.sourceCount === 'number' && B.sourceCount >= 2);
      assert.ok(Array.isArray(B.sources));

      const srcs = /** @type {Array<{ provider?: string }>} */ (
        Array.isArray(B.sources) ? B.sources : []
      );

      const prov = srcs.map((s) => s.provider).sort().join('|');
      assert.ok(prov.includes('bitpay') && prov.includes('coinbase'));

      const qProv = report.quoteProviders;
      assert.ok(Array.isArray(qProv), 'quoteProviders should be an array');
      assert.strictEqual(qProv.length, 7);
      const byId = Object.fromEntries(
        qProv.map((/** @type {{ id?: string }} */ p) => [p.id, p])
      );
      assert.ok(byId.bitpay && byId.coinbase);
      assert.strictEqual(byId.bitpay.enabled, true);
      assert.strictEqual(byId.coingecko.enabled, false);
      assert.strictEqual(byId.kraken.enabled, false);
      assert.strictEqual(byId.bitstamp.enabled, false);
      assert.strictEqual(
        typeof byId.bitpay.quotesBySymbol,
        'object',
        'per-provider quotes snapshot'
      );
      assert.ok(
        byId.bitpay.quotesBySymbol &&
          typeof byId.bitpay.quotesBySymbol.BTC === 'object',
        'BitPay BTC quote in telemetry'
      );
      assert.ok(
        byId.bitpay.nextFetchAt === null ||
          (typeof byId.bitpay.nextFetchAt === 'number' &&
            Number.isFinite(byId.bitpay.nextFetchAt)),
        'quoteProviders expose nextFetchAt'
      );

      const ps = /** @type {Record<string, unknown>} */ (
        report.persistedSnapshot && typeof report.persistedSnapshot === 'object'
          ? report.persistedSnapshot
          : {}
      );

      assert.ok(
        typeof ps.historyRows === 'number' && Number.isFinite(ps.historyRows)
      );
      assert.ok(typeof ps.envelopeSchema === 'number');

      const ph = report.priceHistory;
      assert.ok(Array.isArray(ph), 'priceHistory should be an array');
      assert.ok(ph.length >= 1, 'priceHistory should include sync snapshots');

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });
});

describe('Feed HTTP (/feed/utxoracle/estimate)', function () {
  this.timeout(20_000);

  it('returns 503 when UTXOracle is disabled', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-utxo-'));

    try {
      const persistPath = path.join(tmpRoot, 'lvl');

      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          utxoracle: { enabled: false },
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        },
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      feed.bitpay.http.get = async (p) => {
        if (p === '/rates/BTC') return { data: [{ code: 'USD', rate: 60_111 }] };
        if (p === '/rates') return { data: [{ code: 'USD', rate: 1 }] };
        return { data: [] };
      };
      feed.coinbase.http.get = async () => ({
        price: '60222.2',
        time: '2020-01-15T12:00:00.000Z'
      });

      await feed.start();

      const off = await fetch(
        `http://127.0.0.1:${port}/feed/utxoracle/estimate?height=100`
      );
      assert.strictEqual(off.status, 503);
      const offBody = /** @type {{ error?: string }} */ (await off.json());
      assert.ok(
        typeof offBody.error === 'string' && offBody.error.length > 0,
        'error message when UTXOracle off'
      );

      const noQuery = await fetch(
        `http://127.0.0.1:${port}/feed/utxoracle/estimate`
      );
      assert.strictEqual(
        noQuery.status,
        503,
        'disabled feed rejects before height validation'
      );

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });
});

describe('Feed HTTP (/feed/utxoracle/estimate-series)', function () {
  this.timeout(20_000);

  it('returns 503 when UTXOracle is disabled', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feed-http-utxo-series-')
    );

    try {
      const persistPath = path.join(tmpRoot, 'lvl');

      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          utxoracle: { enabled: false },
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        },
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      feed.bitpay.http.get = async (p) => {
        if (p === '/rates/BTC') return { data: [{ code: 'USD', rate: 60_111 }] };
        if (p === '/rates') return { data: [{ code: 'USD', rate: 1 }] };
        return { data: [] };
      };
      feed.coinbase.http.get = async () => ({
        price: '60222.2',
        time: '2020-01-15T12:00:00.000Z'
      });

      await feed.start();

      const off = await fetch(
        `http://127.0.0.1:${port}/feed/utxoracle/estimate-series?minHeight=0&maxHeight=100&maxPoints=5`
      );
      assert.strictEqual(off.status, 503);
      const offBody = /** @type {{ error?: string }} */ (await off.json());
      assert.ok(
        typeof offBody.error === 'string' && offBody.error.length > 0,
        'error message when UTXOracle off'
      );

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });
});
