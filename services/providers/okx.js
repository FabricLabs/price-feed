'use strict';

/**
 * OKX spot ticker (`/api/v5/market/ticker?instId=BTC-USDT`) with `last` + `ts`.
 * @see https://www.okx.com/docs-v5/en/#rest-api-market-data-get-ticker
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class OKX extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        symbols: ['BTC']
      },
      this.settings,
      settings
    );

    this.http = new Worker({
      serviceId: 'okx',
      label: 'OKX',
      authority: 'www.okx.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v5/market/ticker?instId=BTC-USDT');
    throwIfFabricHttpError(data, 'OKX');

    const row = Array.isArray(data?.data) ? data.data[0] : null;
    const price = Number(row?.last);
    if (!Number.isFinite(price)) {
      throw new Error('OKX: missing or invalid last price.');
    }

    const tsMs = Number(row?.ts);
    const asOfMs = Number.isFinite(tsMs) && tsMs > 0
      ? Math.round(tsMs)
      : Math.round(Date.now());

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: Number.isFinite(tsMs) && tsMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v5/market/books?instId=BTC-USDT&sz=20');
    throwIfFabricHttpError(data, 'OKX');
    const row = Array.isArray(data?.data) ? data.data[0] : null;
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    const ts = Number(row?.ts);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = OKX;
