'use strict';

const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');
const Hash256 = require('@fabric/core/types/hash256');
const Signer = require('@fabric/core/types/signer');
const CoinMarketCap = require('./coinmarketcap');

class Feed extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'BTC',
      interval: 10 * 60 * 1000,
      fabric: null,
      symbols: [
        'BTC',
        'LTC',
        'NMC'
      ],
      sync: true
    }, this.settings, settings);

    // Internals
    this.peer = new Peer(this.fabric);
    this.signer = new Signer(this.settings.identity);

    // Sources (internal)
    this.cmc = new CoinMarketCap(this.settings.sources.coinmarketcap);

    // Timer
    this._syncService = null;

    // Internal State
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

    if (this.settings.sync) {
      await this._sync();
      this._syncService = setInterval(this._sync.bind(this), this.settings.interval);
    }

    if (this.settings.fabric) {
      await this.peer.start();
    }

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
