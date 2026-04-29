'use strict';

/**
 * CoinGecko public API — `simple/price` with optional `last_updated_at` (Unix **seconds**).
 * Falls back to integer fetch time when the field is absent (rate limits / older responses).
 * @see https://www.coingecko.com/en/api/documentation
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfCoingeckoError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class CoinGecko extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        symbols: ['BTC']
      },
      this.settings,
      settings
    );

    this.http = new Worker({
      serviceId: 'coingecko',
      label: 'CoinGecko',
      authority: 'api.coingecko.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const qs =
      'ids=bitcoin&vs_currencies=usd&precision=full&include_last_updated_at=true';
    const data = await this.http.get(`/api/v3/simple/price?${qs}`);
    throwIfCoingeckoError(data, 'CoinGecko');

    const usd = data?.bitcoin?.usd;
    const price = typeof usd === 'number' ? usd : Number(usd);
    if (!Number.isFinite(price)) {
      throw new Error('CoinGecko: missing or invalid bitcoin.usd price.');
    }

    const lu = data?.bitcoin?.last_updated_at;
    let asOfMs = Math.round(Date.now());
    let asOfSource = /** @type {'venue'|'fetch'} */ ('fetch');
    if (lu != null) {
      const sec = Number(lu);
      if (Number.isFinite(sec) && sec > 0) {
        asOfMs = Math.round(sec * 1000);
        asOfSource = 'venue';
      }
    }

    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource
    });
  }
}

module.exports = CoinGecko;
