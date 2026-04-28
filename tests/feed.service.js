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
    it('is an instance of a function', function () {
      assert.equal(Feed instanceof Function, true);
    });

    it('can be instantiated with no input', function () {
      const feed = new Feed();
      assert.ok(feed);
    });

    it('can be started with no input', async function () {
      const port = await getFreeListenPort();
      const feed = new Feed({
        sync: false,
        http: { bind: '127.0.0.1', port, host: 'localhost', secure: false },
      });
      await feed.start();
      await feed.stop();
      assert.ok(feed);
    });

    it('generates a sane quote', async function () {
      const CURRENCY = 'BTC';
      const feed = new Feed({
        currency: CURRENCY,
        symbols: ['BTC'],
      });

      const report = await feed.generateReport();

      assert.ok(report);
      assert.ok(report.attestation);
      assert.ok(report.values);
      assert.ok(report.values[CURRENCY]);

      assert.strictEqual(report.currency, CURRENCY);
    });

    it('can get a quote without configuration', async () => {
      const feed = new Feed();
      const report = await feed.generateReport();
      assert.ok(report);
    });
  });
});
