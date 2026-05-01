'use strict';

/**
 * Crypto.com public ticker (`/v2/public/get-ticker?instrument_name=BTC_USDT`) with `a` ask / `k` close.
 * @see https://exchange-docs.crypto.com/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class CryptoCom extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        symbols: ['BTC']
      },
      this.settings,
      settings
    );

    this.http = new Worker({
      serviceId: 'cryptocom',
      label: 'Crypto.com',
      authority: 'api.crypto.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v2/public/get-ticker?instrument_name=BTC_USDT');
    throwIfFabricHttpError(data, 'Crypto.com');

    const row = data?.result?.data;
    const price = Number(row?.a ?? row?.k ?? row?.v);
    if (!Number.isFinite(price)) {
      throw new Error('Crypto.com: missing or invalid ticker price.');
    }

    const tsMs = Number(data?.result?.t ?? data?.result?.time ?? data?.id);
    const asOfMs = Number.isFinite(tsMs) && tsMs > 0
      ? Math.round(tsMs)
      : Math.round(Date.now());

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v2/public/get-book?instrument_name=BTC_USDT&depth=20');
    throwIfFabricHttpError(data, 'Crypto.com');
    const row = data?.result?.data || {};
    const bidsRaw = Array.isArray(row?.bids) ? row.bids : [];
    const asksRaw = Array.isArray(row?.asks) ? row.asks : [];
    const bids = bidsRaw.map((r) => [r?.[0], r?.[1]]);
    const asks = asksRaw.map((r) => [r?.[0], r?.[1]]);
    const norm = this.normalizeOrderBookLevels(bids, asks);
    const ts = Number(data?.result?.t ?? data?.id);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = CryptoCom;
