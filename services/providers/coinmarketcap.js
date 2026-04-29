'use strict';

const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class CoinMarketCap extends QuoteProvider {
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
      serviceId: 'coinmarketcap',
      label: 'CoinMarketCap',
      authority: 'pro-api.coinmarketcap.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  /** @returns {{ quote: object, asset: object }} */
  async _latestDataForSymbol (symbol) {
    this.assertBtc(symbol);

    const path =
      `/${['v1', 'cryptocurrency', 'quotes', 'latest'].join('/')}` +
      `?symbol=${symbol}&convert=${this.currency}&CMC_PRO_API_KEY=${this.settings.key}`;

    const result = await this.http.get(path);
    throwIfFabricHttpError(result, 'CoinMarketCap');

    if (!result?.data) {
      throw new Error('CoinMarketCap: empty data envelope.');
    }

    const asset = result.data[symbol];
    if (!asset) {
      throw new Error(`CoinMarketCap: no row for ${symbol}.`);
    }

    const row = asset.quote && typeof asset.quote === 'object'
      ? asset.quote[this.currency]
      : null;
    const price = row != null ? Number(row.price) : NaN;
    if (!Number.isFinite(price)) {
      throw new Error(`CoinMarketCap: invalid ${this.currency} price.`);
    }

    const created = new Date(asset.last_updated);
    const asOfMs = created.getTime();
    if (!Number.isFinite(asOfMs)) {
      throw new Error('CoinMarketCap: invalid last_updated timestamp.');
    }

    const quote = normalizeSpotQuote({
      price,
      currency: this.currency,
      asOfMs,
      asOfSource: 'venue'
    });

    return { quote, asset };
  }

  async getPriceForSymbol (symbol) {
    const { quote } = await this._latestDataForSymbol(symbol);
    return quote.price;
  }

  async getQuoteForSymbol (symbol) {
    const { quote } = await this._latestDataForSymbol(symbol);
    return quote;
  }

  async getAssetForSymbol (symbol) {
    const { quote, asset } = await this._latestDataForSymbol(symbol);
    return {
      quote,
      original: asset
    };
  }
}

module.exports = CoinMarketCap;
