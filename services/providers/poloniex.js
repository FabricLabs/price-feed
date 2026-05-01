'use strict';

/**
 * Poloniex ticker (`/markets/BTC_USDT/ticker24h`) with `close` + `closeTime`.
 * @see https://api-docs.poloniex.com/spot/api/public/market-data
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Poloniex extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'poloniex',
      label: 'Poloniex',
      authority: 'api.poloniex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/markets/BTC_USDT/ticker24h');
    throwIfFabricHttpError(data, 'Poloniex');
    const price = Number(data?.close ?? data?.last);
    if (!Number.isFinite(price)) throw new Error('Poloniex: missing or invalid close price.');
    const tsMs = Number(data?.closeTime ?? data?.ts);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Number.isFinite(tsMs) && tsMs > 0 ? Math.round(tsMs) : Math.round(Date.now()),
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/markets/BTC_USDT/orderBook?limit=20');
    throwIfFabricHttpError(data, 'Poloniex');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = Poloniex;
