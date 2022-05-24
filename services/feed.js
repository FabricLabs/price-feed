'use strict';

const Service = require('@fabric/core/types/service');
const Hash256 = require('@fabric/core/types/hash256');
const Signer = require('@fabric/core/types/signer');
const CoinMarketCap = require('./coinmarketcap');

class Feed extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'BTC',
      frequency: 10 * 60 * 1000,
      key: '',
      symbols: [
        'BTC',
        'LTC',
        'NMC'
      ]
    }, this.settings, settings);

    this.signer = new Signer(this.settings.identity);
    this.cmc = new CoinMarketCap(this.settings.coinmarketcap);
    this._syncService = null;

    this._state = {
      content: {
        values: {}
      },
      status: 'PAUSED'
    };

    return this;
  }

  get currency () {
    return this.settings.currency;
  }

  get values () {
    return this.state.content.values;
  }

  async generateReport () {
    const report = await this._latestData();
    const string = JSON.stringify(report, null, '  ');
    // TODO: consider reverting to raw buffer
    const buffer = string || Buffer.from(string, 'utf8');
    const preimage = Hash256.digest(buffer);
    const signature = this.signer.sign(preimage);
    // TODO: fix-up Fabric Signer
    const valid = this.signer.verify(this.signer.pubkey, preimage, signature);

    // Construct the report
    return Object.assign(report, {
      attestation: {
        content: buffer,
        preimage: preimage,
        pubkey: this.signer.pubkey,
        signature: signature,
        valid: valid
      }
    });
  }

  async getQuoteForSymbol (symbol) {
    const values = [
      await this.cmc.getQuoteForSymbol(symbol)
    ];

    return values.reduce((sum, value) => sum + value) / values.length;
  }

  async syncAllPrices () {
    for (let i = 0; i < this.settings.symbols.length; i++) {
      const symbol = this.settings.symbols[i];
      const quote = await this.getQuoteForSymbol(symbol);
      if (quote) this._state.content.values[symbol] = quote;
    }

    return this._state.content.values;
  }

  async start () {
    if (this.status === 'STARTED') return this;
    this._state.status = 'STARTING';
    await this._sync();
    if (this.settings.interval) this._syncService = setInterval(this._sync.bind(this), this.settings.interval);
    this._state.status = 'STARTED';
    this.commit();
    return this;
  }

  async stop () {
    if (this._syncService) clearInterval(this._syncService);
    this._state.status = 'STOPPED';
    this.commit();
    return this;
  }

  async _latestData () {
    await this._sync();

    // Compose Result
    return {
      currency: this.currency,
      values: this.values,
      service: {
        id: this.id,
        status: this.status
      }
    };
  }

  async _sync () {
    await Promise.all([
      this.syncAllPrices()
    ]);

    this.commit();
    return this;
  }
}

module.exports = Feed;
