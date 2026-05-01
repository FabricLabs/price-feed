'use strict';

/**
 * BingX spot ticker (`/openApi/spot/v1/ticker/24hr?symbol=BTC-USDT`) with `lastPrice`.
 * @see https://bingx-api.github.io/docs/#/en-us/spot/changelog
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class BingX extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'bingx',
      label: 'BingX',
      authority: 'open-api.bingx.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/openApi/spot/v1/ticker/24hr?symbol=BTC-USDT');
    throwIfFabricHttpError(data, 'BingX');
    const row = data?.data || data;
    const price = Number(row?.lastPrice ?? row?.last_price ?? row?.last);
    if (!Number.isFinite(price)) throw new Error('BingX: missing or invalid ticker price.');
    const tsMs = Number(row?.closeTime ?? row?.time);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Number.isFinite(tsMs) && tsMs > 0 ? Math.round(tsMs) : Math.round(Date.now()),
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/openApi/spot/v1/market/depth?symbol=BTC-USDT&limit=20');
    throwIfFabricHttpError(data, 'BingX');
    const row = data?.data || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = BingX;
