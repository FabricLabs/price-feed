'use strict';

/**
 * Bitvavo ticker (`/v2/ticker/price?market=BTC-EUR`) with `price` (EUR proxy quote).
 * @see https://docs.bitvavo.com/
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Bitvavo extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        symbols: ['BTC'],
        market: 'BTC-EUR',
        currency: 'EUR'
      },
      this.settings,
      settings
    );

    this.http = new Worker({
      serviceId: 'bitvavo',
      label: 'Bitvavo',
      authority: 'api.bitvavo.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const market = encodeURIComponent(String(this.settings.market || 'BTC-EUR'));
    const data = await this.http.get(`/v2/ticker/price?market=${market}`);
    throwIfFabricHttpError(data, 'Bitvavo');

    const row = Array.isArray(data) ? data[0] : data;
    const price = Number(row?.price);
    if (!Number.isFinite(price)) {
      throw new Error('Bitvavo: missing or invalid price.');
    }

    const marketStr = String(this.settings.market || 'BTC-EUR');
    const quoteCur = marketStr.includes('-')
      ? String(marketStr.split('-')[1] || '').trim().toUpperCase()
      : '';

    return normalizeSpotQuote({
      price,
      currency: quoteCur || String(this.settings.currency || 'EUR').toUpperCase(),
      asOfMs: Math.round(Date.now()),
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const market = encodeURIComponent(String(this.settings.market || 'BTC-EUR'));
    const data = await this.http.get(`/v2/${market}/book?depth=20`);
    throwIfFabricHttpError(data, 'Bitvavo');
    const norm = this.normalizeOrderBookLevels(data?.bids, data?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = Bitvavo;
