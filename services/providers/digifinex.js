'use strict';

/**
 * DigiFinex ticker (`/v3/ticker?symbol=btc_usdt`) with `price`.
 * @see https://docs.digifinex.com/en-ww/spot/v3/rest.html
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class DigiFinex extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'digifinex',
      label: 'DigiFinex',
      authority: 'openapi.digifinex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v3/ticker?symbol=btc_usdt');
    throwIfFabricHttpError(data, 'DigiFinex');
    const row = data?.ticker?.[0] || data?.data?.[0] || data?.data || data;
    const price = Number(row?.price ?? row?.last);
    if (!Number.isFinite(price)) throw new Error('DigiFinex: missing or invalid ticker price.');
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Math.round(Date.now()),
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v3/depth?symbol=btc_usdt&limit=20');
    throwIfFabricHttpError(data, 'DigiFinex');
    const row = data?.bids || data?.asks ? data : (data?.data || {});
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = DigiFinex;
