'use strict';

/**
 * CEX.IO ticker (`/api/ticker/BTC/USD`) with `last` + `timestamp` (Unix seconds).
 * @see https://cex.io/rest-api
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class CEXIO extends QuoteProvider {
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
      serviceId: 'cexio',
      label: 'CEX.IO',
      authority: 'cex.io',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/ticker/BTC/USD');
    throwIfFabricHttpError(data, 'CEX.IO');

    const price = Number(data?.last);
    if (!Number.isFinite(price)) {
      throw new Error('CEX.IO: missing or invalid last price.');
    }

    const tsSec = Number(data?.timestamp);
    const asOfMs = Number.isFinite(tsSec) && tsSec > 0
      ? Math.round(tsSec * 1000)
      : Math.round(Date.now());

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: Number.isFinite(tsSec) && tsSec > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/order_book/BTC/USD/?depth=20');
    throwIfFabricHttpError(data, 'CEX.IO');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = CEXIO;
