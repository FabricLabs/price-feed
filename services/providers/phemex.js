'use strict';

/**
 * Phemex ticker (`/md/v2/ticker/24hr?symbol=BTCUSDT`) with `result.lastEp` (1e4 scaled) + `timestamp`.
 * @see https://phemex-docs.github.io/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Phemex extends QuoteProvider {
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
      serviceId: 'phemex',
      label: 'Phemex',
      authority: 'api.phemex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/md/v2/ticker/24hr?symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'Phemex');

    const scale = Number(this.settings.priceScale || 10000);
    const ep = Number(data?.result?.lastEp);
    const price = Number.isFinite(ep) && scale > 0 ? ep / scale : NaN;
    if (!Number.isFinite(price)) {
      throw new Error('Phemex: missing or invalid lastEp.');
    }

    const tsMs = Number(data?.result?.timestamp ?? data?.timestamp);
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
    const data = await this.http.get('/md/v2/orderbook?symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'Phemex');
    const scale = Number(this.settings.priceScale || 10000);
    const row = data?.result || {};
    const bidsRaw = Array.isArray(row?.book?.bids)
      ? row.book.bids.map((r) => [Number(r[0]) / scale, r[1]])
      : [];
    const asksRaw = Array.isArray(row?.book?.asks)
      ? row.book.asks.map((r) => [Number(r[0]) / scale, r[1]])
      : [];
    const norm = this.normalizeOrderBookLevels(bidsRaw, asksRaw);
    const ts = Number(row?.timestamp ?? data?.timestamp);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = Phemex;
