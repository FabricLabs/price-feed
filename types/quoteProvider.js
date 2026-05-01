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

  /**
   * Fetch level-2 style orderbook for `symbol`.
   * Providers should override when public orderbook endpoints are available.
   *
   * @param {string} symbol
   * @returns {Promise<{ bids: Array<[number, number]>, asks: Array<[number, number]>, asOfMs?: number }>}
   */
  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    throw new Error(`${this.providerId}: orderbook not supported.`);
  }

  /**
   * Normalize raw bid/ask levels into numeric tuples.
   * @param {unknown[]} bids
   * @param {unknown[]} asks
   * @returns {{ bids: Array<[number, number]>, asks: Array<[number, number]> }}
   */
  normalizeOrderBookLevels (bids, asks) {
    const toLevels = (rows) => {
      if (!Array.isArray(rows)) return [];
      /** @type {Array<[number, number]>} */
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row) || row.length < 2) continue;
        const price = Number(row[0]);
        const size = Number(row[1]);
        if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
        if (price <= 0 || size <= 0) continue;
        out.push([price, size]);
      }
      return out;
    };
    return {
      bids: toLevels(bids),
      asks: toLevels(asks)
    };
  }

  /**
   * Depth metric used by feed depth-weighted averaging.
   * Uses top-of-book notional on both sides:
   * `depth = bidPrice*bidSize + askPrice*askSize`.
   *
   * @param {string} symbol
   * @returns {Promise<{ depth: number, bidDepth: number, askDepth: number, asOfMs: number }|null>}
   */
  async getDepthForSymbol (symbol) {
    const book = await this.getOrderBookForSymbol(symbol);
    if (!book || typeof book !== 'object') return null;
    const bids = Array.isArray(book.bids) ? book.bids : [];
    const asks = Array.isArray(book.asks) ? book.asks : [];
    if (!bids.length || !asks.length) return null;

    const bid = bids[0];
    const ask = asks[0];
    if (!Array.isArray(bid) || !Array.isArray(ask)) return null;
    const bidNotional = Number(bid[0]) * Number(bid[1]);
    const askNotional = Number(ask[0]) * Number(ask[1]);
    const depth = bidNotional + askNotional;
    if (!Number.isFinite(depth) || depth <= 0) return null;

    const asOfRaw = Number(book.asOfMs);
    return {
      depth,
      bidDepth: bidNotional,
      askDepth: askNotional,
      asOfMs:
        Number.isFinite(asOfRaw) && asOfRaw > 0
          ? Math.round(asOfRaw)
          : Date.now()
    };
  }
}

module.exports = QuoteProvider;
