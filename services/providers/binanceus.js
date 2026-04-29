'use strict';

/**
 * Binance.US 24h ticker (`/api/v3/ticker/24hr?symbol=BTCUSD`) includes `lastPrice` and `closeTime`.
 * @see https://docs.binance.us/developer-guides/rest-api
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class BinanceUS extends QuoteProvider {
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
      serviceId: 'binanceus',
      label: 'Binance.US',
      authority: 'api.binance.us',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v3/ticker/24hr?symbol=BTCUSD');
    throwIfFabricHttpError(data, 'Binance.US');

    const price = Number(data?.lastPrice);
    if (!Number.isFinite(price)) {
      throw new Error('Binance.US: missing or invalid lastPrice.');
    }

    const closeTimeMs = Number(data?.closeTime);
    const asOfMs = Number.isFinite(closeTimeMs) && closeTimeMs > 0
      ? Math.round(closeTimeMs)
      : Math.round(Date.now());
    const asOfSource = Number.isFinite(closeTimeMs) && closeTimeMs > 0
      ? 'venue'
      : 'fetch';

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource
    });
  }
}

module.exports = BinanceUS;
