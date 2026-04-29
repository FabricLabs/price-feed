'use strict';

const assert = require('assert');
const { quoteAsOfMs } = require('../types/quoteTime');

describe('quoteTime', function () {
  it('quoteAsOfMs reads asOfMs', () => {
    assert.strictEqual(
      quoteAsOfMs({ asOfMs: 1700 }),
      1700
    );
  });

  it('quoteAsOfMs parses created', () => {
    const t = Date.parse('2020-01-15T12:00:00.000Z');
    assert.strictEqual(
      quoteAsOfMs({ created: '2020-01-15T12:00:00.000Z' }),
      t
    );
    assert.strictEqual(
      quoteAsOfMs({ created: new Date(t) }),
      t
    );
  });
});
