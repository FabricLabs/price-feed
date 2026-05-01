'use strict';

const QuoteProvider = require('../../types/quoteProvider');
const Worker = require('../../types/worker');
const { throwIfFabricHttpError } = require('../../types/remoteResponse');
const { normalizeSpotQuote, ageLogFromAsOfMs } = require('../../types/spotQuote');

class BitPay extends QuoteProvider {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign(
      {
        quoteCurrency: 'USD',
        symbols: ['BTC']
      },
      this.settings,
      settings
    );

    this.http = new Worker({
      serviceId: 'bitpay',
      label: 'BitPay',
      authority: 'bitpay.com',
      timeoutMs: this.settings.timeoutMs
    });
    this.remote = this.http.remote;
  }

  async getAllQuotesForSymbol (symbol) {
    this.assertBtc(symbol);

    const asOfMs = Math.round(Date.now());
    const result = await this.http.get('/rates');
    throwIfFabricHttpError(result, 'BitPay');

    const age = ageLogFromAsOfMs(asOfMs);

    return result.data.map((price) => ({
      age,
      created: new Date(asOfMs),
      currency: price.code,
      price: price.rate
    }));
  }

  async syncAllQuotesForSymbol (symbol) {
    const quotes = await this.getAllQuotesForSymbol(symbol);

    for (let i = 0; i < quotes.length; i++) {
      const quote = quotes[i];
      this._state.content.prices[quote.currency] = quote.price;
    }

    this.commit();
    return this;
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    const fiatCode = this.settings.quoteCurrency ?? 'USD';
    const result = await this.http.get(`/rates/${symbol}`);
    throwIfFabricHttpError(result, 'BitPay');

    const quoteRow =
      result.data instanceof Array
        ? result.data.find((candidate) => candidate.code === fiatCode)
        : result.data;

    if (
      !quoteRow ||
      typeof quoteRow !== 'object' ||
      quoteRow.rate == null
    ) {
      throw new Error(`BitPay: no ${fiatCode} rate in response.`);
    }

    const rate = Number(quoteRow.rate);
    if (!Number.isFinite(rate)) {
      throw new Error('BitPay: invalid numeric rate.');
    }

    const asOfMs = Math.round(Date.now());
    return normalizeSpotQuote({
      price: rate,
      currency: fiatCode,
      asOfMs,
      asOfSource: 'fetch'
    });
  }

  async getOrderBookForSymbol (symbol) {
    this.assertBtc(symbol);
    throw new Error('BitPay: orderbook is not available for rates endpoint.');
  }
}

module.exports = BitPay;
