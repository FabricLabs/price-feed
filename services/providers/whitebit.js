'use strict';

/**
 * WhiteBIT ticker (`/api/v4/public/ticker?market=BTC_USDT`) with `last_price`.
 * @see https://whitebit-exchange.github.io/api-docs/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class WhiteBIT extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'whitebit',
      label: 'WhiteBIT',
      authority: 'whitebit.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v4/public/ticker?market=BTC_USDT');
    throwIfFabricHttpError(data, 'WhiteBIT');
    const row = Array.isArray(data) ? data[0] : data;
    const price = Number(row?.last_price);
    if (!Number.isFinite(price)) throw new Error('WhiteBIT: missing or invalid last_price.');
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Math.round(Date.now()),
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v4/public/orderbook/BTC_USDT?limit=20');
    throwIfFabricHttpError(data, 'WhiteBIT');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = WhiteBIT;
