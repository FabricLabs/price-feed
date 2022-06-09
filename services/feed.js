'use strict';

const ESTIMATE_MODE = 'weighted';

const Actor = require('@fabric/core/types/actor');
const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');
const Hash256 = require('@fabric/core/types/hash256');
const Signer = require('@fabric/core/types/signer');
const HTTPServer = require('@fabric/http/types/server');

const BitPay = require('./bitpay');
const Coinbase = require('./coinbase');
const CoinMarketCap = require('./coinmarketcap');

class Feed extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'BTC',
      http: {
        bind: '0.0.0.0',
        host: 'localhost',
        port: 3000,
        secure: false,
        resources: {
          Quote: {
            name: 'Quote',
            components: {
              list: 'QuoteList',
              view: 'QuoteView'
            }
          }
        }
      },
      interval: 10 * 60 * 1000,
      fabric: null,
      sources: {
        bitpay: {},
        coinbase: {},
        coinmarketcap: {}
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

    this.coinbase = new Coinbase({
      ...this.settings.sources.coinmarketcap,
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
      history: [],
      states: {},
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

  commit () {
    const state = new Actor(this.state);
    this._state.states[state.id] = state.toObject();
    this._state.history.push(state.id);

    if (this.observer) {
      try {
        const patches = manager.generate(this.observer);
        if (patches.length) {
          this.history.push(patches);
          this.emit('patches', patches);
        }
      } catch (E) {
        console.error('Could not generate patches:', E);
      }
    }

    const commit = new Actor({
      type: 'Commit',
      state: this.state
    });

    this.emit('commit', { ...commit.toObject(), id: commit.id });

    return commit.id;
  }

  estimateFromQuotes (quotes) {
    if (!quotes || !quotes.length) throw new Error('No quotes provided.');

    let estimate = null;

    switch (ESTIMATE_MODE) {
      default:
      case 'weighted':
        let mass = 0;
        let sum = 0;

        for (let i = 0; i < quotes.length; i++) {
          const quote = quotes[i];
          const weight = 1 / quote.age;
          const value = weight * quote.price;

          mass += weight;
          sum += value;
        }

        estimate = sum / mass;
        break;
      case 'average':
        estimate = quotes
          .map(quote => quote.price)
          .reduce((sum, value) => sum + value) / quotes.length;
        break;
    }

    return estimate;
  }

  trust (source, name = source.constructor.name) {
    super.trust(source);

    const self = this;

    source.on('quote', function handleSourceQuote (quote) {
      const actor = new Actor({
        type: 'Quote',
        data: {
          ...quote,
          source: name
        }
      });

      self._state.quotes[actor.id] = actor.toObject();
      self.commit();
    });

    return this;
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
    const retrievers = [
      this.bitpay.getQuoteForSymbol(symbol),
      this.coinbase.getQuoteForSymbol(symbol)
    ];

    if (this.settings.sources.coinmarketcap.key) {
      retrievers.push(this.cmc.getQuoteForSymbol(symbol));
    }

    const results = await Promise.allSettled(retrievers);
    const quotes = results
      .filter(result => (result.status === 'fulfilled'))
      .map(result => result.value);

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

    this.trust(this.bitpay, 'BITPAY');
    this.trust(this.coinbase, 'COINBASE');
    this.trust(this.cmc, 'COINMARKETCAP');

    // Start HTTP Service
    await this.http.start();

    // If Fabric enabled, start
    if (this.settings.fabric) {
      await this.peer.start();
    }

    // If sync enabled, start
    if (this.settings.sync) {
      await this._sync();
      this._syncService = setInterval(this._sync.bind(this), this.settings.interval);
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
