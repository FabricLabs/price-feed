'use strict';

/**
 * LBank ticker (`/v2/ticker/24hr.do?symbol=btc_usdt`) with `ticker.latest`.
 * @see https://www.lbank.com/docs/index.html
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class LBank extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'lbank',
      label: 'LBank',
      authority: 'api.lbkex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v2/ticker/24hr.do?symbol=btc_usdt');
    throwIfFabricHttpError(data, 'LBank');
    const row = data?.data?.[0] || data?.data || data;
    const price = Number(row?.ticker?.latest ?? row?.latest);
    if (!Number.isFinite(price)) throw new Error('LBank: missing or invalid latest.');
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Math.round(Date.now()),
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v2/depth.do?symbol=btc_usdt&size=20');
    throwIfFabricHttpError(data, 'LBank');
    const row = data?.data || data;
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = LBank;
