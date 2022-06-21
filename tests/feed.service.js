'use strict';

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
