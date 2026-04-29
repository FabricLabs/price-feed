'use strict';

/**
 * Base class for spot quote providers. {@link ../services/feed} calls
 * `getQuoteForSymbol`, merges with inverse-age weighting ({@link ./quoteTime}),
 * and exposes aggregated JSON under **`GET /quotes/snapshot`** (legacy `/feed/report`).
 */

const Service = require('@fabric/core/types/service');

class QuoteProvider extends Service {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.providerId] Stable id for logs (defaults to class name).
   * @param {string} [settings.currency] Fiat (or quote) currency code, e.g. `USD`.
   * @param {string} [settings.quoteCurrency] Same role as `currency` when an API names it differently.
   * @param {string[]} [settings.symbols] Declared symbols; feed only uses BTC.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        providerId: null,
        currency: 'USD',
        quoteCurrency: 'USD',
        symbols: ['BTC']
      },
      this.settings,
      settings
    );

    if (!this.settings.providerId) {
      this.settings.providerId = this.constructor.name;
    }

    if (!this._state || typeof this._state !== 'object') {
      this._state = { content: { prices: {} } };
    } else if (!this._state.content) {
      this._state.content = { prices: {} };
    }
  }

  get currency () {
    return this.settings.currency;
  }

  /** @returns {string} */
  get providerId () {
    return this.settings.providerId || this.constructor.name;
  }

  assertBtc (symbol) {
    if (symbol !== 'BTC') {
      throw new Error(
        `Only the "BTC" symbol is supported (${this.providerId}).`
      );
    }
  }

  /**
   * ln(elapsed ms) from `Date.now()` at request start—same aging as previous HTTP providers.
   * @param {number} startMs
   * @returns {number}
   */
  latencyAgeFromMs (startMs) {
    return Math.log(Math.max(1, Date.now() - startMs));
  }

  /**
   * ln(elapsed ms) from a wall-clock start {@link Date}.
   * @param {Date} start
   * @returns {number}
   */
  latencyAgeFromStartDate (start) {
    return Math.log(Math.max(1, Date.now() - start.getTime()));
  }

  async getPriceForSymbol (symbol) {
    const q = await this.getQuoteForSymbol(symbol);
    return q.price;
  }

  /**
   * Default “spot + metadata” shape. CoinMarketCap overrides to expose `original` API payload.
   */
  async getAssetForSymbol (symbol) {
    const quote = await this.getQuoteForSymbol(symbol);
    return {
      quote,
      name: 'Bitcoin',
      symbol
    };
  }
}

module.exports = QuoteProvider;
