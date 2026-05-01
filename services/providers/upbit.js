'use strict';

/**
 * Upbit ticker (`/v1/ticker?markets=USDT-BTC`) with `trade_price` + `timestamp`.
 * @see https://global-docs.upbit.com/reference/tickers
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Upbit extends QuoteProvider {
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
      serviceId: 'upbit',
      label: 'Upbit',
      authority: 'api.upbit.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v1/ticker?markets=USDT-BTC');
    throwIfFabricHttpError(data, 'Upbit');

    const row = Array.isArray(data) ? data[0] : null;
    const price = Number(row?.trade_price);
    if (!Number.isFinite(price)) {
      throw new Error('Upbit: missing or invalid trade_price.');
    }

    const tsMs = Number(row?.timestamp);
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
    const data = await this.http.get('/v1/orderbook?markets=USDT-BTC');
    throwIfFabricHttpError(data, 'Upbit');
    const row = Array.isArray(data) ? data[0] : null;
    const units = Array.isArray(row?.orderbook_units) ? row.orderbook_units : [];
    const bidsRaw = units.map((u) => [u?.bid_price, u?.bid_size]);
    const asksRaw = units.map((u) => [u?.ask_price, u?.ask_size]);
    const norm = this.normalizeOrderBookLevels(bidsRaw, asksRaw);
    const ts = Number(row?.timestamp);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = Upbit;
