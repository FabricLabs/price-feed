'use strict';

/**
 * KuCoin level1 ticker (`/api/v1/market/orderbook/level1?symbol=BTC-USDT`) with `price` + `time`.
 * @see https://www.kucoin.com/docs/rest/spot-trading/market-data/get-ticker
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class KuCoin extends QuoteProvider {
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
      serviceId: 'kucoin',
      label: 'KuCoin',
      authority: 'api.kucoin.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v1/market/orderbook/level1?symbol=BTC-USDT');
    throwIfFabricHttpError(data, 'KuCoin');

    if (String(data?.code || '') !== '200000') {
      throw new Error(`KuCoin: ${String(data?.msg || 'request failed')}`);
    }

    const row = data?.data;
    const price = Number(row?.price);
    if (!Number.isFinite(price)) {
      throw new Error('KuCoin: missing or invalid price.');
    }

    const tsMs = Number(row?.time);
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
    const data = await this.http.get('/api/v1/market/orderbook/level2_20?symbol=BTC-USDT');
    throwIfFabricHttpError(data, 'KuCoin');
    if (String(data?.code || '') !== '200000') {
      throw new Error(`KuCoin: ${String(data?.msg || 'request failed')}`);
    }
    const row = data?.data || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    const ts = Number(row?.time);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = KuCoin;
