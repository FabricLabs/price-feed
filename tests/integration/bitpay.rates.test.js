'use strict';

/**
 * Live HTTP — BitPay public API (no API key).
 *
 * Not run by default `npm test` (file lives under tests/integration/).
 *
 *   npm run test:integration
 *
 * Optional: set `NETWORK_TESTS=1` in CI for the integration job only.
 */
const assert = require('node:assert');

const BitPay = require('../../services/providers/bitpay');

describe('BitPay live rates (bitpay.com)', function () {
  this.timeout(60_000);

  it('GET /rates/BTC — BTC/USD quote via getQuoteForSymbol', async function () {
    const bitpay = new BitPay({ quoteCurrency: 'USD' });

    const quote = await bitpay.getQuoteForSymbol('BTC');

    assert.ok(quote);
    assert.strictEqual(quote.currency, 'USD');

    const priceNum = typeof quote.price === 'string' ? parseFloat(quote.price) : Number(quote.price);
    assert.ok(Number.isFinite(priceNum));
    assert.ok(priceNum >= 5000 && priceNum <= 50_000_000, `unexpected BTC spot in USD (got ${priceNum})`);

    assert.ok(quote.created instanceof Date || typeof quote.created === 'string');
    assert.ok(Number.isFinite(quote.age));
  });

  it('GET /rates — many fiat rows via getAllQuotesForSymbol', async function () {
    const bitpay = new BitPay({ quoteCurrency: 'USD' });

    const rows = await bitpay.getAllQuotesForSymbol('BTC');

    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 5, 'expected many fiat rows');

    const usd = rows.find((r) => r.currency === 'USD');
    assert.ok(usd, 'expected a USD row');
    const p = typeof usd.price === 'string' ? parseFloat(usd.price) : Number(usd.price);
    assert.ok(Number.isFinite(p) && p >= 5000);
  });
});
