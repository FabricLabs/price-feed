'use strict';

/**
 * Bitfinex public ticker (`/v2/ticker/tBTCUSD`) array response.
 * @see https://docs.bitfinex.com/reference/rest-public-ticker
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Bitfinex extends QuoteProvider {
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
      serviceId: 'bitfinex',
      label: 'Bitfinex',
      authority: 'api-pub.bitfinex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v2/ticker/tBTCUSD');
    throwIfFabricHttpError(data, 'Bitfinex');
    if (!Array.isArray(data) || data.length < 11) {
      throw new Error('Bitfinex: invalid ticker payload.');
    }

    const price = Number(data[6]);
    if (!Number.isFinite(price)) {
      throw new Error('Bitfinex: invalid last price.');
    }

    const firstTradeMs = Number(data[10]);
    const asOfMs = Number.isFinite(firstTradeMs) && firstTradeMs > 0
      ? Math.round(firstTradeMs)
      : Math.round(Date.now());
    const asOfSource = Number.isFinite(firstTradeMs) && firstTradeMs > 0
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

module.exports = Bitfinex;
