'use strict';

/**
 * Binance global 24h ticker (`/api/v3/ticker/24hr?symbol=BTCUSDT`) with `lastPrice` + `closeTime`.
 * @see https://github.com/binance/binance-spot-api-docs
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Binance extends QuoteProvider {
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
      serviceId: 'binance',
      label: 'Binance',
      authority: 'api.binance.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v3/ticker/24hr?symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'Binance');

    const price = Number(data?.lastPrice);
    if (!Number.isFinite(price)) {
      throw new Error('Binance: missing or invalid lastPrice.');
    }

    const closeTimeMs = Number(data?.closeTime);
    const asOfMs = Number.isFinite(closeTimeMs) && closeTimeMs > 0
      ? Math.round(closeTimeMs)
      : Math.round(Date.now());

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: Number.isFinite(closeTimeMs) && closeTimeMs > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v3/depth?symbol=BTCUSDT&limit=20');
    throwIfFabricHttpError(data, 'Binance');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    const ts = Number(data?.E);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = Binance;
