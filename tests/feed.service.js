'use strict';

// const log = require('why-is-node-running');

const assert = require('assert');
const Feed = require('../services/feed');
const settings = require('../settings/test');

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
      const feed = new Feed();
      await feed.start();
      await feed.stop();
      assert.ok(feed);
    });

    xit('can be started with test configuration', async function () {
      const feed = new Feed(settings);
      await feed.start();
      await feed.stop();
      assert.ok(feed);
      setTimeout(log, 5000);
    });

    xit('can serve a websocket', function (done) {
      async function test () {
        const feed = new Feed();
        await feed.start();

        const socket = new WebSocket('ws://localhost:8080');

        // Connection opened
        socket.addEventListener('open', function (event) {
            socket.send('Hello Server!');
        });

        // Listen for messages
        socket.addEventListener('message', function (event) {
            console.log('Message from server ', event.data);
        });

        assert.ok(feed);
        done();
      }

      test();
    });

    xit('generates a sane quote', async function () {
      const CURRENCY = 'BTC';
      const feed = new Feed({
        currency: CURRENCY,
        symbols: ['BTC']
      });

      const report = await feed.generateReport();

      assert.ok(report);
      assert.ok(report.attestation);
      assert.ok(report.values);
      assert.ok(report.values[CURRENCY]);

      assert.strictEqual(report.currency, CURRENCY);
    });

    xit('can get a quote without configuration', async function () {
      const feed = new Feed();
      const report = await feed.generateReport();
      assert.ok(report);
    });
  });
});
