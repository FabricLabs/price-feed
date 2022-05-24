'use strict';

const Service = require('@fabric/core/types/service');
const Remote = require('@fabric/http/types/remote');

class CoinMarketCap extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'USD',
      symbols: [
        'BTC'
      ]
    }, this.settings, settings);

    this.remote = new Remote({
      authority: 'pro-api.coinmarketcap.com'
    });

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
    const asset = await this.getAssetForSymbol(symbol);
    return asset.quote;
  }

  async getAssetForSymbol (symbol) {
    const result = await this.remote._GET('/' + [
      'v1',
      'cryptocurrency',
      'quotes',
      'latest'
    ].join('/') + `?symbol=${symbol}&convert=${this.currency}&CMC_PRO_API_KEY=${this.settings.key}`);

    const asset = result.data[symbol];
    const created = Date.parse(asset.last_updated);
    const ageInMS = Date.now() - created;
    const age = Math.log(ageInMS);

    return {
      quote: {
        age: age,
        ageInMS: ageInMS,
        created: asset.last_updated,
        currency: this.currency,
        price: asset.quote[this.currency].price
      },
      original: asset
    };
  }
}

module.exports = CoinMarketCap;
