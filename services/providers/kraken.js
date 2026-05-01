'use strict';

/**
 * Kraken public **Trades** (latest fill) — price + sub-second trade time (UTC).
 * @see https://docs.kraken.com/rest/#tag/Market-Data/operation/getRecentTrades
 */
const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote } = require('../../types/spotQuote');

class Kraken extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        symbols: ['BTC'],
        /** REST pair passed to `Trades` (default spot XBT/USD). */
        tickerPair: 'XBTUSD'
      },
      this.settings,
      settings
    );

    this.http = new Worker({
      serviceId: 'kraken',
      label: 'Kraken',
      authority: 'api.kraken.com',
      secure: true,
      port: 443,
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const pair = encodeURIComponent(this.settings.tickerPair || 'XBTUSD');
    const data = await this.http.get(
      `/0/public/Trades?pair=${pair}&count=1`
    );

    throwIfFabricHttpError(data, 'Kraken');

    if (data?.error?.length) {
      throw new Error(`Kraken: ${data.error.join('; ')}`);
    }

    const result = data?.result;
    if (!result || typeof result !== 'object') {
      throw new Error('Kraken: empty trades result.');
    }

    const pairKey = Object.keys(result).filter((k) => k !== 'last')[0];
    const rows = pairKey && Array.isArray(result[pairKey])
      ? result[pairKey]
      : null;
    const row = rows && rows.length ? rows[0] : null;
    if (!Array.isArray(row) || row.length < 3) {
      throw new Error('Kraken: no trade row in response.');
    }

    const price = Number(row[0]);
    const timeSec = Number(row[2]);
    if (!Number.isFinite(price) || !Number.isFinite(timeSec)) {
      throw new Error('Kraken: invalid trade price or time.');
    }

    const asOfMs = Math.round(timeSec * 1000);
    return normalizeSpotQuote({
      price,
      currency: 'USD',
      asOfMs,
      asOfSource: 'venue'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    const pair = encodeURIComponent(this.settings.tickerPair || 'XBTUSD');
    const data = await this.http.get(`/0/public/Depth?pair=${pair}&count=20`);
    throwIfFabricHttpError(data, 'Kraken');
    if (data?.error?.length) {
      throw new Error(`Kraken: ${data.error.join('; ')}`);
    }
    const result = data?.result;
    const pairKey = result && typeof result === 'object'
      ? Object.keys(result)[0]
      : '';
    const row = pairKey ? result[pairKey] : null;
    const norm = this.normalizeOrderBookLevels(row?.bids, row?.asks);
    return {
      bids: norm.bids,
      asks: norm.asks,
      asOfMs: Date.now()
    };
  }
}

module.exports = Kraken;
