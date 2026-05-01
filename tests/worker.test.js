'use strict';

const assert = require('node:assert');
const Worker = require('../types/worker');

describe('Worker', function () {
  it('requires serviceId', function () {
    assert.throws(
      () => new Worker({ authority: 'example.com' }),
      /serviceId/
    );
  });

  it('requires authority or host', function () {
    assert.throws(
      () => new Worker({ serviceId: 'x' }),
      /authority or settings\.host/
    );
  });

  it('exposes label from serviceId when label omitted', function () {
    const w = new Worker({ serviceId: 'acme', authority: 'api.example.com' });
    assert.strictEqual(w.label, 'Acme');
    assert.strictEqual(w.serviceId, 'acme');
    assert.ok(w.remote);
  });

  it('delegates get to Remote._GET', async function () {
    const w = new Worker({ serviceId: 't', authority: 'example.com' });
    let seenPath;
    w.remote._GET = async (path) => {
      seenPath = path;
      return { ok: true };
    };
    const out = await w.get('/v1/x');
    assert.strictEqual(seenPath, '/v1/x');
    assert.deepStrictEqual(out, { ok: true });
  });

  describe('rate-limit helpers', function () {
    it('errorIndicatesRateLimit matches Fabric-style messages and numeric code', () => {
      assert.strictEqual(
        Worker.errorIndicatesRateLimit(new Error('BitPay: Rate limited [429]')),
        true
      );
      assert.strictEqual(
        Worker.errorIndicatesRateLimit(new Error('Something [503]')),
        true
      );
      assert.strictEqual(
        Worker.errorIndicatesRateLimit(
          Object.assign(new Error('x'), { code: 429 })
        ),
        true
      );
      assert.strictEqual(
        Worker.errorIndicatesRateLimit(
          Object.assign(new Error('x'), { code: 500 })
        ),
        false
      );
      assert.strictEqual(Worker.errorIndicatesRateLimit(new Error('boom')), false);
    });

    it('rateLimitBackoffMs increases with streak and stays within bounds (deterministic rng)', () => {
      const rngAlwaysHalf = () => 0.5;
      const a = Worker.rateLimitBackoffMs(1, rngAlwaysHalf);
      const b = Worker.rateLimitBackoffMs(12, rngAlwaysHalf);
      assert.ok(a >= 2500 && a <= 120_000);
      assert.ok(b >= 2500 && b <= 120_000);
      assert.ok(b > a, 'later streak should yield longer (or equal) delay');
    });
  });

  it('rejects when _GET exceeds timeoutMs', async function () {
    const w = new Worker({
      serviceId: 't',
      authority: 'example.com',
      timeoutMs: 60
    });
    w.remote._GET = async () =>
      await new Promise((resolve) => {
        setTimeout(resolve, 60_000);
      });
    await assert.rejects(w.get('/slow'), /timed out/);
  });
});
