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
    }

    return this;
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

    // Request from Coinbase
    const start = new Date();
    const result = await this.remote._GET(`/v2/exchange-rates?currency=${symbol}`);
    const age = Math.log(new Date() - start);

    // Return valid Quote
    return {
      age: age,
      created: start,
      currency: currency,
      price: parseFloat(result.data.rates[currency])
    };
  }

  async getAssetForSymbol (symbol) {
    const quote = await this.getQuoteForSymbol(symbol);

    // Return valid asset, with quote
    return {
      quote: quote,
      name: 'Bitcoin',
      symbol: symbol
    };
  }
}

module.exports = Coinbase;
