'use strict';

/**
 * Coinbase **Exchange** public ticker — venue `time` + `price` (exact UTC instant).
 * @see https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getproductticker
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Coinbase extends QuoteProvider {
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
      serviceId: 'coinbase',
      label: 'Coinbase Exchange',
      authority: 'api.exchange.coinbase.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const currency = this.currency;
    const data = await this.http.get('/products/BTC-USD/ticker');
    throwIfFabricHttpError(data, 'Coinbase Exchange');

    const price = Number(data?.price);
    if (!Number.isFinite(price)) {
      throw new Error('Coinbase Exchange: invalid or missing price.');
    }

    const timeIso = data?.time;
    const asOfMs = Date.parse(String(timeIso || ''));
    if (!Number.isFinite(asOfMs)) {
      throw new Error('Coinbase Exchange: missing or invalid ticker time.');
    }

    return normalizeSpotQuote({
      price,
      currency,
      asOfMs,
      asOfSource: 'venue'
    });
  }
}

module.exports = Coinbase;
