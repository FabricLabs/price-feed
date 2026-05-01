'use strict';

/**
 * Gate.io spot ticker (`/api/v4/spot/tickers?currency_pair=BTC_USDT`) array with `last`.
 * @see https://www.gate.io/docs/developers/apiv4/en/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class GateIO extends QuoteProvider {
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
      serviceId: 'gateio',
      label: 'Gate.io',
      authority: 'api.gateio.ws',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v4/spot/tickers?currency_pair=BTC_USDT');
    throwIfFabricHttpError(data, 'Gate.io');

    const row = Array.isArray(data) ? data[0] : null;
    const price = Number(row?.last);
    if (!Number.isFinite(price)) {
      throw new Error('Gate.io: missing or invalid last price.');
    }

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs: Math.round(Date.now()),
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/api/v4/spot/order_book?currency_pair=BTC_USDT&limit=20');
    throwIfFabricHttpError(data, 'Gate.io');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    const ts = Number(data?.current);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts * 1000) : Date.now()
    };
  }
}

module.exports = GateIO;
