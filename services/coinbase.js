'use strict';

const Service = require('@fabric/core/types/service');
const Remote = require('@fabric/http/types/remote');

class Coinbase extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'USD',
      symbols: [
        'BTC'
      ]
    }, this.settings, settings);

    this.remote = new Remote({
      authority: 'api.coinbase.com'
    });

    this._state = {
      content: {
        prices: {}
      }
    };
  }

  get currency () {
    return this.settings.currency;
  }

  async getPriceForSymbol (symbol) {
    const asset = await this.getQuoteForSymbol(symbol);
    return asset.price;
  }

  async getQuoteForSymbol (symbol) {
    if (symbol !== 'BTC') throw new Error('Only the "BTC" symbol is supported.');

    const currency = this.currency;

    const startMs = Date.now();
    const result = await this.remote._GET(`/v2/exchange-rates?currency=${symbol}`);
    const age = Math.log(Date.now() - startMs);

    const rates = result?.data?.rates;
    const priceRaw = rates && Object.prototype.hasOwnProperty.call(rates, currency)
      ? rates[currency]
      : undefined;

    return {
      age: age,
      created: new Date(startMs),
      currency: currency,
      price: parseFloat(priceRaw)
    };
  }

  async getAssetForSymbol (symbol) {
    const quote = await this.getQuoteForSymbol(symbol);

    return {
      quote: quote,
      name: 'Bitcoin',
      symbol: symbol
    };
  }
}

module.exports = Coinbase;
