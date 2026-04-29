'use strict';

/**
 * Bitstamp public v2 ticker — `last`, venue `timestamp` (Unix seconds).
 * @see https://www.bitstamp.net/api/
 */
const QuoteProvider = require('../types/quoteProvider');
const Worker = require('../types/worker');
const { throwIfFabricHttpError } = require('../types/remoteResponse');
const { normalizeSpotQuote } = require('../types/spotQuote');

class Bitstamp extends QuoteProvider {
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
      serviceId: 'bitstamp',
      label: 'Bitstamp',
      authority: 'www.bitstamp.net',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v2/ticker/btcusd/');
    throwIfFabricHttpError(data, 'Bitstamp');

    const lastRaw = data?.last;
    const price = Number(lastRaw);
    if (!Number.isFinite(price)) {
      throw new Error('Bitstamp: missing or invalid last price.');
    }

    const tsSec = Number(data?.timestamp);
    if (!Number.isFinite(tsSec)) {
      throw new Error('Bitstamp: missing or invalid ticker timestamp.');
    }

    const asOfMs = Math.round(tsSec * 1000);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: 'venue'
    });
  }
}

module.exports = Bitstamp;
