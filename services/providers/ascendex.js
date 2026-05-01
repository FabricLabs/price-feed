'use strict';

/**
 * AscendEX ticker (`/api/pro/v1/ticker?symbol=BTC/USDT`) with `close` + optional `ts`.
 * @see https://ascendex.github.io/ascendex-pro-api/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class AscendEX extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'ascendex',
      label: 'AscendEX',
      authority: 'ascendex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/pro/v1/ticker?symbol=BTC/USDT');
    throwIfFabricHttpError(data, 'AscendEX');
    const row = data?.data || data;
    const price = Number(row?.close);
    if (!Number.isFinite(price)) throw new Error('AscendEX: missing or invalid close.');
    const tsMs = Number(row?.ts);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Number.isFinite(tsMs) && tsMs > 0 ? Math.round(tsMs) : Math.round(Date.now()),
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/pro/v1/depth?symbol=BTC/USDT');
    throwIfFabricHttpError(data, 'AscendEX');
    const row = data?.data || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(Number(row?.ts)) ? Math.round(Number(row.ts)) : Date.now()
    };
  }
}

module.exports = AscendEX;
