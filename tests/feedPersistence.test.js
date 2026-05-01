'use strict';

const assert = require('assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FeedPriceStore = require('../types/feedPriceStore');

describe('FeedPriceStore', function () {
  this.timeout(20_000);

  /** @type {string} */
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-persist-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
      /* noop */
    }
  });

  it('normalizeEnvelope upgrades legacy flat blob', () => {
    const v1 = {
      values: { BTC: { price: 1, sourceCount: 1 } },
      brokerCache: {},
      historyRows: []
    };
    const n = FeedPriceStore.normalizeEnvelope(v1);
    assert.strictEqual(n.schemaVersion, 1);
    assert.strictEqual(n.values.BTC.price, 1);
  });

  it('normalizeEnvelope unwraps snapshot.v2 blobs', () => {
    const v2 = {
      schemaVersion: 2,
      snapshot: {
        values: { BTC: { price: 99, sources: [] } },
        brokerCache: {},
        historyRows: [],
        meta: { k: true }
      }
    };
    const n = FeedPriceStore.normalizeEnvelope(v2);
    assert.strictEqual(n.schemaVersion, 2);
    assert.strictEqual(n.values.BTC.price, 99);
    assert.strictEqual(n.meta.k, true);
  });

  it('round-trips snapshot through Level storage', async () => {
    const p = new FeedPriceStore({
      path: path.join(tmpRoot, 'lvl'),
      verbosity: 0,
      snapshotKey: 'fabric.feed.snapshot.test'
    });

    await p.open();

    await p.save({
      values: {
        BTC: {
          price: 65_000,
          sourceCount: 2,
          sources: [
            {
              provider: 'bitpay',
              label: 'BitPay',
              price: 64_950,
              fromCache: false
            }
          ]
        }
      },
      brokerCache: { 'bitpay:BTC': { fetchedAt: Date.now(), quote: { price: 1 } } },
      historyRows: [{ ts: 1, schema: 2, values: {} }],
      meta: { fixture: true }
    });

    await p.stop();

    const p2 = new FeedPriceStore({
      path: path.join(tmpRoot, 'lvl'),
      verbosity: 0,
      snapshotKey: 'fabric.feed.snapshot.test'
    });

    const loaded = await p2.load();
    assert.ok(loaded);

    await p2.stop();

    assert.strictEqual(
      typeof loaded.schemaVersion === 'number',
      true
    );

    /** @type {{ price?: number, sources?: unknown[] }} */
    const btc = loaded.values.BTC || {};
    assert.strictEqual(btc.price, 65_000);
    assert.ok(Array.isArray(btc.sources));

    /** @type {unknown[]} */
    const hist = loaded.historyRows;
    assert.ok(Array.isArray(hist));

    /** @type {Record<string, unknown>} */
    const m = typeof loaded.meta === 'object' && loaded.meta !== null
      ? loaded.meta
      : {};
    assert.strictEqual(m.fixture, true);
  });
});
