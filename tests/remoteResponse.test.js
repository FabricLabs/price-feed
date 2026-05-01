'use strict';

const assert = require('node:assert');
const {
  throwIfFabricHttpError,
  throwIfCoingeckoError
} = require('../types/remoteResponse');

describe('remoteResponse', function () {
  it('throwIfFabricHttpError detects Fabric Remote envelopes', function () {
    assert.throws(
      () =>
        throwIfFabricHttpError(
          { status: 'error', message: 'Document not found.' },
          'X'
        ),
      /X: Document not found\./
    );
    assert.throws(
      () =>
        throwIfFabricHttpError(
          {
            status: 'error',
            message: 'Unhandled HTTP status code.',
            code: 429
          },
          'BitPay'
        ),
      /BitPay: Rate limited \[429\]/
    );
    assert.doesNotThrow(() => throwIfFabricHttpError({ ok: true }, 'X'));
  });

  it('throwIfCoingeckoError detects Coingecko quota errors', function () {
    assert.throws(
      () =>
        throwIfCoingeckoError(
          {
            status: {
              error_code: 429,
              error_message: 'Rate limit'
            }
          },
          'CG'
        ),
      /CG: Rate limit \[429\]/
    );
  });
});
