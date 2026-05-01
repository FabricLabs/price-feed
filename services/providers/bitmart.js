'use strict';

/**
 * BitMart ticker (`/spot/quotation/v3/tickers?symbol=BTC_USDT`) with `lastPrice`.
 * @see https://developer-pro.bitmart.com/en/spot/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class BitMart extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'bitmart',
      label: 'BitMart',
      authority: 'api-cloud.bitmart.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/spot/quotation/v3/tickers?symbol=BTC_USDT');
    throwIfFabricHttpError(data, 'BitMart');
    const row = data?.data?.tickers?.[0] || data?.data?.[0] || data?.data || data;
    const price = Number(row?.lastPrice ?? row?.last_price ?? row?.last);
    if (!Number.isFinite(price)) throw new Error('BitMart: missing or invalid ticker price.');
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Math.round(Date.now()),
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/spot/quotation/v3/books?symbol=BTC_USDT&limit=20');
    throwIfFabricHttpError(data, 'BitMart');
    const row = data?.data || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = BitMart;
