'use strict';

/**
 * CoinEx ticker (`/v1/market/ticker?market=BTCUSDT`) with `data.ticker.last` + `date`.
 * @see https://docs.coinex.com/api/v1/market
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class CoinEx extends QuoteProvider {
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
      serviceId: 'coinex',
      label: 'CoinEx',
      authority: 'api.coinex.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v1/market/ticker?market=BTCUSDT');
    throwIfFabricHttpError(data, 'CoinEx');

    if (Number(data?.code) !== 0) {
      throw new Error(`CoinEx: ${String(data?.message || 'request failed')}`);
    }

    const price = Number(data?.data?.ticker?.last);
    if (!Number.isFinite(price)) {
      throw new Error('CoinEx: missing or invalid last price.');
    }

    const tsSec = Number(data?.data?.date ?? data?.date);
    const asOfMs = Number.isFinite(tsSec) && tsSec > 0
      ? Math.round(tsSec * 1000)
      : Math.round(Date.now());

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: Number.isFinite(tsSec) && tsSec > 0 ? 'venue' : 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const data = await this.http.get('/v1/market/depth?market=BTCUSDT&limit=20&merge=0');
    throwIfFabricHttpError(data, 'CoinEx');
    if (Number(data?.code) !== 0) {
      throw new Error(`CoinEx: ${String(data?.message || 'request failed')}`);
    }
    const row = data?.data || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = CoinEx;
