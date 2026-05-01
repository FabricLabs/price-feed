'use strict';

const assert = require('assert');
const {
  findCentralOutput
} = require('../services/utxoracle');

describe('UTXOracle core helpers', () => {
  it('findCentralOutput picks geometric median of clustered prices', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      pts.push(99_950 + i * 2);
    }
    const { central } = findCentralOutput(pts, 90_000, 110_000);
    assert.ok(Number.isFinite(central));
    assert.ok(central >= 99_940 && central <= 99_988);
  });
});
