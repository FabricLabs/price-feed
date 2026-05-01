'use strict';

/**
 * Bitget spot ticker (`/api/v2/spot/market/tickers?symbol=BTCUSDT`) with `lastPr`.
 * @see https://www.bitget.com/api-doc/spot/market/Get-Tickers
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Bitget extends QuoteProvider {
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
      serviceId: 'bitget',
      label: 'Bitget',
      authority: 'api.bitget.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const data = await this.http.get('/api/v2/spot/market/tickers?symbol=BTCUSDT');
    throwIfFabricHttpError(data, 'Bitget');

    if (String(data?.code || '') !== '00000') {
      throw new Error(`Bitget: ${String(data?.msg || 'request failed')}`);
    }

    const row = Array.isArray(data?.data) ? data.data[0] : null;
    const price = Number(row?.lastPr);
    if (!Number.isFinite(price)) {
      throw new Error('Bitget: missing or invalid lastPr.');
    }

    const tsMs = Number(row?.ts ?? data?.requestTime);
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
    const data = await this.http.get('/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=20');
    throwIfFabricHttpError(data, 'Bitget');
    if (String(data?.code || '') !== '00000') {
      throw new Error(`Bitget: ${String(data?.msg || 'request failed')}`);
    }
    const row = data?.data || {};
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    const ts = Number(row?.ts ?? data?.requestTime);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now()
    };
  }
}

module.exports = Bitget;
