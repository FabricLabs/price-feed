'use strict';

/**
 * Bitso ticker (`/v3/ticker/?book=btc_usd`) with `payload.last` + `payload.created_at`.
 * @see https://docs.bitso.com/bitso-api/docs/ticker
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Bitso extends QuoteProvider {
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
      serviceId: 'bitso',
      label: 'Bitso',
      authority: 'api.bitso.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v3/ticker/?book=btc_usd');
    throwIfFabricHttpError(data, 'Bitso');

    const payload = data?.payload;
    const price = Number(payload?.last);
    if (!Number.isFinite(price)) {
      throw new Error('Bitso: missing or invalid last price.');
    }

    const createdAt = Date.parse(String(payload?.created_at || ''));
    const asOfMs = Number.isFinite(createdAt)
      ? Math.round(createdAt)
      : Math.round(Date.now());

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: Number.isFinite(createdAt) ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v3/order_book/?book=btc_usd');
    throwIfFabricHttpError(data, 'Bitso');
    const row = data?.payload || data;
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = Bitso;
