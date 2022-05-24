module.exports = {
  currency: 'BTC',
  identity: {
    // This is a sample seed.  Replace with one of your own.
    seed: 'arrest model vacant obscure kitchen ice rack spider antique pull double discover'
  },
  interval: 10 * 60 * 1000, // sync every 10 mins, or ~4383 requests per month
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
