module.exports = {
  currency: 'BTC',
  debug: true,
  identity: {
    // This is a sample seed.  Replace with one of your own.
    seed: 'arrest model vacant obscure kitchen ice rack spider antique pull double discover'
  },
  interval: 60 * 60 * 1000, // sync every hour, or ~730 calls/month per symbol
  sources: {
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
