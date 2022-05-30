'use strict';

const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');
const Hash256 = require('@fabric/core/types/hash256');
const Signer = require('@fabric/core/types/signer');
const HTTPServer = require('@fabric/http/types/server');

const BitPay = require('./bitpay');
const CoinMarketCap = require('./coinmarketcap');

class Feed extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'BTC',
      http: {
        bind: '0.0.0.0',
        host: 'localhost.localdomain',
        port: 3000,
        secure: false
      },
      interval: 10 * 60 * 1000,
      fabric: null,
      sources: {
        bitpay: {}
      },
      symbols: [
        'BTC',
        'LTC',
        'NMC'
      ],
      sync: true
    }, this.settings, settings);

    // Internals
    this.http = new HTTPServer(this.settings.http);
    this.peer = new Peer(this.settings.fabric);
    this.signer = new Signer(this.settings.identity);

    // Sources (internal)
    // TODO: use subservices architecture
    this.bitpay = new BitPay({
      ...this.settings.sources.bitpay,
      currency: this.settings.currency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.cmc = new CoinMarketCap({
      ...this.settings.sources.coinmarketcap,
      currency: this.settings.currency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

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
    return this.state.values;
  }

  estimateFromQuotes (quotes) {
    const average = quotes
      .map(quote => quote.price)
      .reduce((sum, value) => sum + value) / quotes.length;

    return average;
  }

  async generateReport () {
    const report = await this._latestData();
    const string = JSON.stringify(report, null, '  ');
    // TODO: consider reverting to raw buffer
    const buffer = string || Buffer.from(string, 'utf8');
    const preimage = Hash256.digest(buffer);
    const signature = this.signer.sign(Buffer.from(preimage, 'hex'));
    // TODO: fix-up Fabric Signer
    const valid = this.signer.verify(this.signer.pubkey, preimage, signature);

    // Construct the report
    return {
      ...report,
      attestation: {
        content: buffer,
        preimage: preimage,
        pubkey: this.signer.pubkey,
        signature: signature,
        valid: valid
      }
    };
  }

  async getAssetForSymbol (symbol) {
    return this.cmc.getAssetForSymbol(symbol);
  }

  async getQuoteForSymbol (symbol) {
    const quotes = await Promise.all([
      this.bitpay.getQuoteForSymbol(symbol),
      this.cmc.getQuoteForSymbol(symbol)
    ]);

    console.log('quotes:', quotes);

    return {
      price: this.estimateFromQuotes(quotes)
    };
  }

  async syncAllPrices () {
    if (this.currency === 'BTC') await this.bitpay.syncAllQuotesForSymbol('BTC');

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
