'use strict';

/**
 * MEXC spot 24h ticker (`/api/v3/ticker/24hr?symbol=BTCUSDT`) with `lastPrice` + `closeTime`.
 * @see https://mexcdevelop.github.io/apidocs/spot_v3_en/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class MEXC extends QuoteProvider {
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
      serviceId: 'mexc',
      label: 'MEXC',
      authority: 'api.mexc.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v3/ticker/24hr?symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'MEXC');

    const price = Number(data?.lastPrice);
    if (!Number.isFinite(price)) {
      throw new Error('MEXC: missing or invalid lastPrice.');
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
    throwIfFabricHttpError(data, 'MEXC');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = MEXC;
