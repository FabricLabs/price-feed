'use strict';

/**
 * HTX merged ticker (`/market/detail/merged?symbol=btcusdt`) with `tick.close`.
 * @see https://www.htx.com/en-us/opend/newApiPages/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class HTX extends QuoteProvider {
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
      serviceId: 'htx',
      label: 'HTX',
      authority: 'api.huobi.pro',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/market/detail/merged?symbol=btcusdt');
    throwIfFabricHttpError(data, 'HTX');

    if (String(data?.status || '').toLowerCase() !== 'ok') {
      throw new Error(`HTX: ${String(data?.err_msg || 'request failed')}`);
    }

    const price = Number(data?.tick?.close);
    if (!Number.isFinite(price)) {
      throw new Error('HTX: missing or invalid close price.');
    }

    const tsMs = Number(data?.ts);
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
    const data = await this.http.get('/market/depth?symbol=btcusdt&type=step0');
    throwIfFabricHttpError(data, 'HTX');
    if (String(data?.status || '').toLowerCase() !== 'ok') {
      throw new Error(`HTX: ${String(data?.err_msg || 'request failed')}`);
    }
    const row = data?.tick || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    const ts = Number(data?.ts);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = HTX;
