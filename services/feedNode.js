'use strict';

/**
 * Feed process wrapper: suppresses noisy Fabric `[FABRIC:COMMIT] [PROGRAM]` spam and
 * logs consolidated pricing reports on a fixed interval and on new Bitcoin tip height
 * (when {@link UTXOracle} is enabled).
 */

const Node = require('@fabric/core/types/node');

const PRICING_LOG_INTERVAL_MS = 60_000;
const CHAIN_TIP_POLL_MS = 15_000;

class FeedNode extends Node {
  constructor (settings = {}) {
    super(settings);

    /** @type {number} */
    this._lastPricingReportTs = 0;
    /** @type {number|null} */
    this._lastLoggedChainTip = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    this._pricingInterval = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    this._blockWatchInterval = null;
    /** @type {boolean} */
    this._chainTipPrimed = false;
  }

  /**
   * Same as {@link Node#trust} but does not `console.log` every `commit` from the feed program.
   * @param {import('events').EventEmitter} source
   * @param {Object|string} [settings]
   */
  trust (source, settings = {}) {
    if (settings !== 'PROGRAM') {
      return super.trust(source, settings);
    }

    const self = this;
    const extra =
      typeof settings === 'string' ? `[${settings}] ` : '';

    source.on('debug', function (debug) {
      self.emit('debug', `[FABRIC:DEBUG] ${extra}${debug}`);
    });

    source.on('connections:open', function (data) {
      self.emit('log', `connection open: ${JSON.stringify(data)}`);
    });

    source.on('connections:close', function (data) {
      self.emit('log', `connection close: ${JSON.stringify(data)}`);
    });

    source.on('chat', function (chat) {
      self.emit('chat', chat);
    });

    source.on('info', function (info) {
      self.emit('info', `${extra}${info}`);
    });

    source.on('log', function (log) {
      self.emit('log', `${extra}${log}`);
    });

    source.on('warning', function (warn) {
      self.emit('warning', `[FABRIC:WARNING] ${extra}${warn}`);
    });

    source.on('error', function (error) {
      self.emit('error', `[FABRIC:ERROR] ${extra}${error}`);
    });

    source.on('exception', function (error) {
      self.emit('error', `[FABRIC:EXCEPTION] ${extra}${error}`);
    });

    source.on('message', function (msg) {
      self.emit('message', `[FABRIC:MESSAGE] ${extra}${msg}`);
    });

    source.on('commit', function () {
      /* Feed commits frequently (_sync, HTTP /quotes/snapshot); use _flushPricingReport instead. */
    });

    source.on('ready', function () {
      self.emit('log', `[FABRIC] ${extra}<${source.constructor.name}> Claimed ready!`);
    });

    return this;
  }

  async start () {
    await super.start();
    this._attachPricingReportTimers();
    return this;
  }

  clearPricingReportTimers () {
    if (this._pricingInterval) {
      clearInterval(this._pricingInterval);
      this._pricingInterval = null;
    }
    if (this._blockWatchInterval) {
      clearInterval(this._blockWatchInterval);
      this._blockWatchInterval = null;
    }
  }

  _attachPricingReportTimers () {
    this.clearPricingReportTimers();

    this._pricingInterval = setInterval(
      () => void this._flushPricingReport('interval'),
      PRICING_LOG_INTERVAL_MS
    );

    this._blockWatchInterval = setInterval(
      () => void this._checkNewBlockAndReport(),
      CHAIN_TIP_POLL_MS
    );
  }

  /**
   * @param {'interval'|'block'} trigger
   * @param {Record<string, unknown>} [extra]
   */
  async _flushPricingReport (trigger, extra = {}) {
    const feed = this.program;
    if (!feed || typeof feed._latestData !== 'function') return;

    const since = this._lastPricingReportTs;
    this._lastPricingReportTs = Date.now();

    try {
      const data = await feed._latestData();
      const history = Array.isArray(data.priceHistory) ? data.priceHistory : [];
      const sinceMs = since > 0 ? since : 0;
      const priceHistorySinceLastReport =
        sinceMs > 0
          ? history.filter((row) => row && typeof row.ts === 'number' && row.ts > sinceMs)
          : history.slice();

      /** @type {Record<string, unknown>} */
      const payload = {
        trigger,
        at: new Date().toISOString(),
        reportWindow: {
          sinceLastReportMs: since > 0 ? since : null,
          priceHistoryRowsSinceLastReport: priceHistorySinceLastReport.length
        },
        currency: data.currency,
        quoteCurrency: data.quoteCurrency,
        symbols: data.symbols,
        values: data.values,
        quoteProviders: data.quoteProviders,
        priceHistorySinceLastReport,
        persistedSnapshot: data.persistedSnapshot,
        ...extra
      };

      if (feed.utxoracle?.settings?.enabled) {
        let chainTip = null;
        try {
          chainTip = await feed.utxoracle._currentTipHeight();
        } catch {
          /* RPC optional for log payload */
        }
        const leh = feed.utxoracle._lastEstimateHeight;
        payload.utxoracle = {
          chainTipHeight: chainTip,
          lastEstimateHeight: leh,
          estimateAnalyzedThroughHeight:
            leh != null ? Math.max(0, leh - 1) : null,
          estimatedUsdBtc: feed.utxoracle._heightQuoteCache?.price ?? null,
          estimateAsOfMs: feed.utxoracle._heightQuoteCache?.startMs ?? null
        };
      }

      console.log('[FEED:PRICING]', JSON.stringify(payload, null, 2));
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error('[FEED:PRICING] failed:', msg);
    }
  }

  async _checkNewBlockAndReport () {
    const feed = this.program;
    if (!feed?.utxoracle?.settings?.enabled) return;
    if (typeof feed.utxoracle._currentTipHeight !== 'function') return;

    let tip;
    try {
      tip = await feed.utxoracle._currentTipHeight();
    } catch {
      return;
    }
    if (tip == null) return;

    if (!this._chainTipPrimed) {
      this._chainTipPrimed = true;
      this._lastLoggedChainTip = tip;
      return;
    }

    if (this._lastLoggedChainTip !== null && tip <= this._lastLoggedChainTip) {
      return;
    }

    if (typeof feed.utxoracle.isChainReadyForAggregation === 'function') {
      let ready = false;
      try {
        ready = await feed.utxoracle.isChainReadyForAggregation();
      } catch {
        ready = false;
      }
      if (!ready) {
        this._lastLoggedChainTip = tip;
        return;
      }
    }

    try {
      await feed.utxoracle.getQuoteForSymbol('BTC');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error('[FEED:PRICING] UTXOracle on new tip:', msg);
    }

    this._lastLoggedChainTip = tip;

    await this._flushPricingReport('block', {
      chainTipHeight: tip
    });
  }
}

module.exports = FeedNode;
module.exports.PRICING_LOG_INTERVAL_MS = PRICING_LOG_INTERVAL_MS;
module.exports.CHAIN_TIP_POLL_MS = CHAIN_TIP_POLL_MS;
