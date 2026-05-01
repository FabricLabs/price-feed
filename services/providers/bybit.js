'use strict';

/**
 * Bybit V5 spot ticker (`/v5/market/tickers?category=spot&symbol=BTCUSDT`) with `lastPrice`.
 * @see https://bybit-exchange.github.io/docs/v5/market/tickers
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Bybit extends QuoteProvider {
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
      serviceId: 'bybit',
      label: 'Bybit',
      authority: 'api.bybit.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/v5/market/tickers?category=spot&symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'Bybit');

    if (String(data?.retCode ?? '0') !== '0') {
      throw new Error(`Bybit: ${String(data?.retMsg || 'request failed')}`);
    }

    const row = Array.isArray(data?.result?.list) ? data.result.list[0] : null;
    const price = Number(row?.lastPrice);
    if (!Number.isFinite(price)) {
      throw new Error('Bybit: missing or invalid lastPrice.');
    }

    const tsMs = Number(data?.time);
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
    const data = await this.http.get('/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=25');
    throwIfFabricHttpError(data, 'Bybit');
    if (String(data?.retCode ?? '0') !== '0') {
      throw new Error(`Bybit: ${String(data?.retMsg || 'request failed')}`);
    }
    const row = data?.result || {};
    const norm = this.normalizeOrderBookLevels(row?.b, row?.a);
    const ts = Number(row?.ts ?? data?.time);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = Bybit;
