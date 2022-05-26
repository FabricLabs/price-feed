'use strict';

const Service = require('@fabric/core/types/service');
const Remote = require('@fabric/http/types/remote');

class BitPay extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'USD',
      symbols: [
        'BTC'
      ]
    }, this.settings, settings);

    this.remote = new Remote({
      authority: 'bitpay.com'
    });

    return this;
  }

  get currency () {
    return this.settings.currency;
  }

  async getAllQuotesForSymbol (symbol) {
    if (symbol !== 'BTC') throw new Error('Only the "BTC" symbol is supported.');

    const start = new Date();
    const result = await this.remote._GET(`/rates`);
    const age = Math.log(new Date() - start);

    return result.data.map(price => {
      return {
        age: age,
        created: start,
        currency: price.code,
        price: price.rate
      }
    });
  }

  async getPriceForSymbol (symbol) {
    const asset = await this.getQuoteForSymbol(symbol);
    return asset.price;
  }

  async getQuoteForSymbol (symbol) {
    if (symbol !== 'BTC') throw new Error('Only the "BTC" symbol is supported.');

    const currency = this.currency;

    // Request from BitPay
    const start = new Date();
    const result = await this.remote._GET(`/rates/${this.currency}`);
    const age = Math.log(new Date() - start);
    const quote = (result.data instanceof Array) ?
      result.data.find(candidate => (candidate.code === currency)) :
      result.data;

    // Return valid Quote
    return {
      age: age,
      created: start,
      currency: this.currency,
      price: quote.rate
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

module.exports = BitPay;
