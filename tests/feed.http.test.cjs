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
  const res = await fetch(`http://127.0.0.1:${port}/quotes/snapshot`);
  assert.strictEqual(res.ok, true, `${res.status} ${res.statusText}`);
  return /** @type {Record<string, unknown>} */ (await res.json());
}

async function readSseUntilDataLine (stream, timeoutMs = 6_000) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let text = '';
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          return line.slice('data: '.length).trim();
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {
      /* noop */
    }
  }
  throw new Error('Timed out waiting for SSE data line');
}

describe('Feed HTTP (/quotes/snapshot)', function () {
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
      assert.strictEqual(qProv.length, 10);
      const byId = Object.fromEntries(
        qProv.map((/** @type {{ id?: string }} */ p) => [p.id, p])
      );
      assert.ok(byId.bitpay && byId.coinbase);
      assert.strictEqual(byId.bitpay.enabled, true);
      assert.strictEqual(byId.coingecko.enabled, false);
      assert.strictEqual(byId.kraken.enabled, false);
      assert.strictEqual(byId.bitstamp.enabled, false);
      assert.strictEqual(byId.gemini.enabled, true);
      assert.strictEqual(byId.bitfinex.enabled, true);
      assert.strictEqual(byId.binanceus.enabled, true);
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

describe('Feed HTTP (/quotes/* decomposed)', function () {
  this.timeout(20_000);

  it('serves spot/providers/history/chain independently', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-decomposed-'));

    try {
      const persistPath = path.join(tmpRoot, 'lvl');

      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false },
          gemini: { enabled: false },
          bitfinex: { enabled: false },
          binanceus: { enabled: false }
        },
        persist: {
          path: persistPath,
          maxHistoryRows: 32
        },
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

      const spotRes = await fetch(`http://127.0.0.1:${port}/quotes/spot`);
      assert.strictEqual(spotRes.ok, true, `${spotRes.status}`);
      const spot = await spotRes.json();
      assert.strictEqual(spot.currency, 'BTC');
      assert.ok(spot.values && typeof spot.values === 'object');

      const providersRes = await fetch(`http://127.0.0.1:${port}/quotes/providers`);
      assert.strictEqual(providersRes.ok, true, `${providersRes.status}`);
      const providers = await providersRes.json();
      assert.ok(Array.isArray(providers.quoteProviders));

      const historyRes = await fetch(
        `http://127.0.0.1:${port}/quotes/history?limit=10`
      );
      assert.strictEqual(historyRes.ok, true, `${historyRes.status}`);
      const history = await historyRes.json();
      assert.ok(Array.isArray(history.priceHistory));
      assert.ok(history.priceHistory.length <= 10);

      const chainRes = await fetch(`http://127.0.0.1:${port}/quotes/chain`);
      assert.strictEqual(chainRes.ok, true, `${chainRes.status}`);
      const chain = await chainRes.json();
      assert.ok(Object.prototype.hasOwnProperty.call(chain, 'utxoracleChain'));

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

describe('Feed HTTP SSE (/quotes/sse)', function () {
  this.timeout(20_000);

  it('streams quote snapshots as SSE events', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-sse-'));

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

      const ac = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/quotes/sse`, {
        signal: ac.signal
      });

      assert.strictEqual(res.status, 200);
      assert.ok(
        (res.headers.get('content-type') || '').includes('text/event-stream')
      );
      assert.ok(res.body, 'SSE response should include a stream body');

      const dataLine = await readSseUntilDataLine(res.body);
      const payload = JSON.parse(dataLine);
      assert.strictEqual(payload.currency, 'BTC');
      assert.ok(payload.values && typeof payload.values === 'object');
      assert.ok(payload.values.BTC && typeof payload.values.BTC === 'object');

      ac.abort();
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

describe('Feed HTTP (/blocks oracle query)', function () {
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
        `http://127.0.0.1:${port}/blocks?minHeight=0&maxHeight=100&maxPoints=5`
      );
      assert.strictEqual(off.status, 503);
      const offBody = /** @type {{ error?: string }} */ (await off.json());
      assert.ok(
        typeof offBody.error === 'string' && offBody.error.length > 0,
        'error message when UTXOracle off'
      );

      const offHeight = await fetch(
        `http://127.0.0.1:${port}/blocks?height=100`
      );
      assert.strictEqual(offHeight.status, 503);

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

describe('Feed HTTP (/blocks)', function () {
  this.timeout(20_000);

  it('serves BitcoinBlocksResource discovery metadata on GET /blocks', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-discovery-'));

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
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      await feed.start();

      const res = await fetch(`http://127.0.0.1:${port}/blocks`);
      assert.strictEqual(res.ok, true, `${res.status}`);
      const j = /** @type {{ '@type'?: string }} */ (await res.json());
      assert.strictEqual(j['@type'], 'BitcoinBlocksResource');

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });

  it('falls back to UTXOracle estimate when /blocks?height= hash resolution is unavailable', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-blocks-fallback-'));

    try {
      const persistPath = path.join(tmpRoot, 'lvl');

      const feed = new Feed({
        currency: 'BTC',
        symbols: ['BTC'],
        sources: {
          utxoracle: { enabled: true },
          coingecko: { enabled: false },
          kraken: { enabled: false },
          bitstamp: { enabled: false }
        },
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      await feed.start();

      feed.bitcoin.getBlockInfo = async () => {
        throw new Error('simulated block lookup outage');
      };
      feed.utxoracle.estimateUsdAtHeight = async (h) => ({
        height: Math.floor(Number(h)),
        analyzedThroughHeight: Math.max(0, Math.floor(Number(h)) - 1),
        price: 12345.67,
        asOfMs: Date.now(),
        currency: 'USD',
        windowBlocks: 144
      });

      const res = await fetch(`http://127.0.0.1:${port}/blocks?height=100`);
      assert.strictEqual(res.status, 200);
      const j = /** @type {{ height?: number, price?: number }} */ (await res.json());
      assert.strictEqual(j.height, 100);
      assert.strictEqual(j.price, 12345.67);

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });

  it('matches block height lookups on /blocks/:height and /blocks/height/', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-blocks-'));

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

      const canon = await fetch(`http://127.0.0.1:${port}/blocks/0`);
      const byHeightSeg = await fetch(`http://127.0.0.1:${port}/blocks/height/0`);
      assert.strictEqual(canon.status, byHeightSeg.status);
      const jc = /** @type {{ error?: string }} */ (await canon.json());
      const jh = /** @type {{ error?: string }} */ (await byHeightSeg.json());
      assert.strictEqual(jc.error, jh.error);

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });

  it('returns 400 for neither hash nor decimal height in /blocks/:id', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-blocks-bad-'));

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
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      await feed.start();

      const bad = await fetch(`http://127.0.0.1:${port}/blocks/not-a-hash`);
      assert.strictEqual(bad.status, 400);

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

describe('Feed HTTP (/transactions)', function () {
  this.timeout(20_000);

  it('returns 400 when txid is not 64 hex characters', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'feed-http-transactions-')
    );

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
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      await feed.start();

      const bad = await fetch(
        `http://127.0.0.1:${port}/transactions/not-valid`
      );
      assert.strictEqual(bad.status, 400);

      await feed.stop();
    } finally {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* noop */
      }
    }
  });

  it('returns 404 when Bitcoin tx lookup fails', async () => {
    const port = await getFreeListenPort();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-http-txs-'));

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
        persist: { path: persistPath, maxHistoryRows: 4 },
        sync: false,
        aggregation: { debounceMs: 12_000 },
        http: { host: '127.0.0.1', port, secure: false, listen: true }
      });

      await feed.start();

      const tx =
        '0000000000000000000000000000000000000000000000000000000000000000';
      const canon = await fetch(
        `http://127.0.0.1:${port}/transactions/${tx}`
      );
      assert.strictEqual(canon.status, 404);
      const jc = /** @type {{ error?: string }} */ (await canon.json());
      assert.ok(typeof jc.error === 'string' && jc.error.length > 0);

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
