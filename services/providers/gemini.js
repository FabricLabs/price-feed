'use strict';

/**
 * Gemini public ticker (`/v1/pubticker/BTCUSD`) with optional venue timestamp.
 * @see https://docs.gemini.com/rest/market-data#get-ticker
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Gemini extends QuoteProvider {
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
      serviceId: 'gemini',
      label: 'Gemini',
      authority: 'api.gemini.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v1/pubticker/BTCUSD');
    throwIfFabricHttpError(data, 'Gemini');

    const price = Number(data?.last);
    if (!Number.isFinite(price)) {
      throw new Error('Gemini: missing or invalid last price.');
    }

    const venueMs = Number(data?.volume?.timestampms);
    const asOfMs = Number.isFinite(venueMs) && venueMs > 0
      ? Math.round(venueMs)
      : Math.round(Date.now());
    const asOfSource = Number.isFinite(venueMs) && venueMs > 0
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

module.exports = Gemini;
