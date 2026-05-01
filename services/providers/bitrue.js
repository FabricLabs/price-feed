'use strict';

/**
 * Bitrue 24h ticker (`/api/v1/ticker/24hr?symbol=BTCUSDT`) with `lastPrice` + `closeTime`.
 * @see https://www.bitrue.com/api_docs_includes_file
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Bitrue extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'bitrue',
      label: 'Bitrue',
      authority: 'openapi.bitrue.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v1/ticker/24hr?symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'Bitrue');
    const price = Number(data?.lastPrice ?? data?.last_price ?? data?.last);
    if (!Number.isFinite(price)) throw new Error('Bitrue: missing or invalid ticker price.');
    const tsMs = Number(data?.closeTime ?? data?.close_time ?? data?.time);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Number.isFinite(tsMs) && tsMs > 0 ? Math.round(tsMs) : Math.round(Date.now()),
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v1/depth?symbol=BTCUSDT&limit=20');
    throwIfFabricHttpError(data, 'Bitrue');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = Bitrue;
