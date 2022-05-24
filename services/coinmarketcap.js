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

  async getQuoteForSymbol (symbol) {
    const asset = await this.getAssetBySymbol(symbol);
    return asset.quote[this.currency].price;
  }

  async getAssetBySymbol (symbol) {
    const result = await this.remote._GET('/' + [
      'v1',
      'cryptocurrency',
      'quotes',
      'latest'
    ].join('/') + `?symbol=${symbol}&convert=${this.currency}&CMC_PRO_API_KEY=${this.settings.key}`);

    return result.data[symbol];
  }
}

module.exports = CoinMarketCap;
