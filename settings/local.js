module.exports = {
  currency: 'BTC',
  debug: true,
  http: {
    port: 8080
  },
  identity: {
    // This is a sample seed.  Replace with one of your own.
    seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  },
  interval: 60 * 60 * 1000, // sync every hour, or ~730 calls/month per symbol
  sources: {
    bitpay: {},
    coinmarketcap: {
      key: 'YOUR_COINMARKETCAP_API_KEY'
    }
  },
  symbols: [
    'BTC',
    'LTC',
    'NMC'
  ],
  sync: true
};
