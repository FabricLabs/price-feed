'use strict';

/**
 * Deribit public ticker (`/api/v2/public/ticker?instrument_name=BTC-USD`) with `last_price`.
 * @see https://docs.deribit.com/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Deribit extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ symbols: ['BTC'] }, this.settings, settings);
    this.http = new Worker({
      serviceId: 'deribit',
      label: 'Deribit',
      authority: 'www.deribit.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v2/public/ticker?instrument_name=BTC-USD');
    throwIfFabricHttpError(data, 'Deribit');
    const row = data?.result || data;
    const price = Number(row?.last_price ?? row?.last);
    if (!Number.isFinite(price)) throw new Error('Deribit: missing or invalid last_price.');
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
    const data = await this.http.get('/api/v2/public/get_order_book?instrument_name=BTC-USD&depth=20');
    throwIfFabricHttpError(data, 'Deribit');
    const row = data?.result || {};
    const bidsRaw = Array.isArray(row?.bids)
      ? row.bids.map((r) => [r[1], r[2]])
      : [];
    const asksRaw = Array.isArray(row?.asks)
      ? row.asks.map((r) => [r[1], r[2]])
      : [];
    const norm = this.normalizeOrderBookLevels(bidsRaw, asksRaw);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(Number(row?.timestamp)) ? Math.round(Number(row.timestamp)) : Date.now()
    };
  }
}

module.exports = Deribit;
