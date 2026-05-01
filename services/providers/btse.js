'use strict';

/**
 * BTSE ticker (`/spot/api/v3.2/market_summary`) list with `symbol=BTC-USD` + `last`.
 * @see https://btsecom.github.io/docs/spot/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class BTSE extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'btse',
      label: 'BTSE',
      authority: 'api.btse.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/spot/api/v3.2/market_summary');
    throwIfFabricHttpError(data, 'BTSE');
    const list = Array.isArray(data) ? data : [];
    const row = list.find((r) => String(r?.symbol || '').toUpperCase() === 'BTC-USD') || list[0];
    const price = Number(row?.last);
    if (!Number.isFinite(price)) throw new Error('BTSE: missing or invalid last.');
    const tsMs = Number(row?.timestamp);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Number.isFinite(tsMs) && tsMs > 0 ? Math.round(tsMs) : Math.round(Date.now()),
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/spot/api/v3.2/orderbook?symbol=BTC-USD&depth=20');
    throwIfFabricHttpError(data, 'BTSE');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = BTSE;
