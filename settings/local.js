module.exports = {
  currency: 'BTC',
  debug: true,
  /** Port and optional `host`: Fabric HTTP uses `host` as the bind address (`listen`). */
  http: {
    port: 5555
  },
  /**
   * Fabric `Bitcoin` service (RPC + optional ZMQ). The Feed constructs one shared instance as
   * `feed.bitcoin` and passes it to UTXOracle. For a managed node, if `zmq` is omitted, the Feed
   * sets ZMQ to tcp 127.0.0.1:29500 to match bitcoind’s `-zmqpub*` from Fabric. Set `zmq: false`
   * to disable the subscriber, or `{ host, port }` for an external publisher.
   */
  bitcoin: {
    managed: true,
    network: 'mainnet',
    listen: false,
    mode: 'fabric',
    zmq: null,
    constraints: {
      storage: {
        size: 550
      }
    },
    bitcoinExtraParams: ['-dbcache=2048']
  },
  identity: {
    // This is a sample seed.  Replace with one of your own.
    seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  },
  /** Fast ticker; outbound calls are debounced (`aggregation.debounceMs`). */
  interval: 1000,
  aggregation: {
    debounceMs: 500,
    concurrency: {
      bitpay: 1,
      coinbase: 1,
      coingecko: 1,
      kraken: 1,
      bitstamp: 1,
      gemini: 1,
      bitfinex: 1,
      binance: 1,
      binanceus: 1,
      okx: 1,
      bybit: 1,
      kucoin: 1,
      gateio: 1,
      mexc: 1,
      bitget: 1,
      htx: 1,
      coinex: 1,
      cexio: 1,
      upbit: 1,
      bitso: 1,
      phemex: 1,
      bitvavo: 1,
      cryptocom: 1,
      whitebit: 1,
      lbank: 1,
      digifinex: 1,
      ascendex: 1,
      btse: 1,
      bitmart: 1,
      bingx: 1,
      bitrue: 1,
      poloniex: 1,
      deribit: 1,
      coinmarketcap: 1,
      utxoracle: 1
    }
  },
  persist: {
    path: './stores/feed-price',
    maxHistoryRows: 2048
  },
  sources: {
    bitpay: {},
    coinbase: {},
    coingecko: {},
    kraken: {},
    bitstamp: {},
    gemini: {},
    bitfinex: {},
    binance: {},
    binanceus: {},
    okx: {},
    bybit: {},
    kucoin: {},
    gateio: {},
    mexc: {},
    bitget: {},
    htx: {},
    coinex: {},
    cexio: {},
    upbit: {},
    bitso: {},
    phemex: {},
    bitvavo: {},
    cryptocom: {},
    whitebit: {},
    lbank: {},
    digifinex: {},
    ascendex: {},
    btse: {},
    bitmart: {},
    bingx: {},
    bitrue: {},
    poloniex: {},
    deribit: {},
    coinmarketcap: {
      key: 'YOUR_COINMARKETCAP_API_KEY'
    },
    utxoracle: {
      enabled: true,
      windowBlocks: 144
    }
  },
  sync: true
};
