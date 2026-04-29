'use strict';

/**
 * **Feed** — Fabric {@link Service} that aggregates BTC spot quotes from {@link QuoteProvider}
 * implementations, persists snapshots, and serves JSON + static UI via {@link HTTPServer}.
 *
 * **Learn the path:** {@link ../types/quoteProvider} → exchange services ({@link ../types/worker}
 * for HTTP) → `_fetchProviderQuotes` / `syncAllPrices` → **`GET /quotes/snapshot`** →
 * {@link ../components/FeedMonitor}.
 *
 * **Bitcoin blocks:** canonical **`GET /blocks/:hash`** returns **`getBlockInfo`** fields plus optional **`utxoracle`** (USD estimate for that height). **`GET /blocks/:num`** (decimal height) **302** → **`/blocks/:hash`**. **`GET /blocks?height=`** resolves the block hash and **302** the same way. **UTXOracle series:** **`GET /blocks?minHeight=&maxHeight=&maxPoints=`**. **`GET /transactions/:txid`** mirrors **`getTransactionInfo`**.
 *
 * **Hub / advanced RPC:** the same HTTP stack supports JSON-RPC and Bridge-friendly patterns
 * (Fabric {@code Message} frames on the default WebSocket upgrade). The dashboard uses a plain JSON
 * WebSocket at **`GET ws…/quotes/stream`** without the Hub Bridge wire format.
 * When UTXOracle is on, a single {@link Bitcoin} client on the Feed owns RPC + ZMQ and forwards
 * Fabric `BitcoinBlock` / `BitcoinBlockHash` messages on that stream for live tip updates.
 *
 * Full JSON snapshots ({@link #_buildReportPayload}) are pushed to subscribers on **`/quotes/stream`**
 * after each {@link #commit} (debounced via {@code settings.aggregation.streamBroadcastDebounceMs}).
 */

// Constants
const ESTIMATE_MODE = 'weighted';
const FEED_QUOTE_TICK_MS = 1000;
const MAX_QUOTE_HISTORY_DEFAULT = 2048;

/** Canonical WebSocket path for aggregated JSON snapshots. */
const QUOTES_STREAM_PATH = '/quotes/stream';
/** Canonical SSE endpoint for aggregated JSON snapshots. */
const QUOTES_SSE_PATH = '/quotes/sse';

// Dependencies
const { generate: generateObserverPatches } = require('fast-json-patch');

// TODO: change this to Actor ID
const { randomUUID } = require('node:crypto');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const { setTlsTelemetryHook } = require('./outboundTelemetry');
const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');
const Hash256 = require('@fabric/core/types/hash256');
const Key = require('@fabric/core/types/key');
const HTTPServer = require('@fabric/http/types/server');

// Services
const BitPay = require('./providers/bitpay');
const Coinbase = require('./providers/coinbase');
const CoinGecko = require('./providers/coingecko');
const Kraken = require('./providers/kraken');
const Bitstamp = require('./providers/bitstamp');
const Gemini = require('./providers/gemini');
const Bitfinex = require('./providers/bitfinex');
const BinanceUS = require('./providers/binanceus');
const CoinMarketCap = require('./providers/coinmarketcap');
const UTXOracle = require('./utxoracle');
const SSEService = require('./sse');
const UTXO_HEIGHT_SERIES_MAX =
  typeof UTXOracle.ESTIMATE_HEIGHT_SERIES_MAX_POINTS === 'number'
    ? UTXOracle.ESTIMATE_HEIGHT_SERIES_MAX_POINTS
    : 2500;
const Bitcoin = require('@fabric/core/services/bitcoin');
const FeedPriceStore = require('../types/feedPriceStore');
const { quoteAsOfMs } = require('../types/quoteTime');
const Worker = require('../types/worker');

const PROVIDER_LABELS = {
  bitpay: 'BitPay',
  coinbase: 'Coinbase',
  coingecko: 'CoinGecko',
  kraken: 'Kraken',
  bitstamp: 'Bitstamp',
  gemini: 'Gemini',
  bitfinex: 'Bitfinex',
  binanceus: 'Binance.US',
  coinmarketcap: 'CoinMarketCap',
  utxoracle: 'UTXOracle (on-chain)'
};

const PROVIDER_IDS = Object.keys(PROVIDER_LABELS);

function quoteProviderResourceKey (id) {
  const pascal = id.charAt(0).toUpperCase() + id.slice(1);
  return `QuoteProvider${pascal}`;
}

/** Non-empty API key that is not an obvious documentation placeholder. */
function isConfiguredCoinmarketcapKey (key) {
  if (key == null) return false;
  const s = String(key).trim();
  if (!s) return false;
  if (/^YOUR_|^CHANGE|^REPLACE|placeholder/i.test(s)) return false;
  return true;
}

/**
 * Bitcoin Core ZMQ publisher port must match {@link Bitcoin#createLocalNode} (default 29500).
 * When `zmq` is omitted and `managed` is true, subscribe so ZMQ `hashblock` / `rawblock` reach **`/quotes/stream`**.
 */
const FEED_BITCOIN_DEFAULT_ZMQ_PORT = 29500;

/**
 * @param {object} feedSettings
 * @returns {object}
 */
function mergeFeedBitcoinSettings (feedSettings) {
  const merged = Object.assign(
    {
      network: 'mainnet',
      managed: true,
      listen: false,
      mode: 'fabric',
      zmq: null,
      constraints: { storage: { size: 550 } }
    },
    typeof feedSettings.bitcoin === 'object' && feedSettings.bitcoin
      ? feedSettings.bitcoin
      : {},
    typeof feedSettings.sources?.utxoracle === 'object' &&
      feedSettings.sources.utxoracle &&
      typeof feedSettings.sources.utxoracle.bitcoin === 'object' &&
      feedSettings.sources.utxoracle.bitcoin
      ? feedSettings.sources.utxoracle.bitcoin
      : {}
  );
  if (merged.zmq == null && merged.managed === true) {
    merged.zmq = { host: '127.0.0.1', port: FEED_BITCOIN_DEFAULT_ZMQ_PORT };
  }
  return merged;
}

/** Object.assign replaces `sources` as a whole; preserve per-provider defaults when users pass a partial `sources` object. */
function normalizeFeedSources (input) {
  const base = {
    bitpay: {},
    coinbase: {},
    coingecko: {},
    kraken: {},
    bitstamp: {},
    gemini: {},
    bitfinex: {},
    binanceus: {},
    coinmarketcap: {},
    utxoracle: { enabled: false }
  };
  const o = input && typeof input === 'object' ? input : {};
  return {
    ...base,
    ...o,
    bitpay: { ...base.bitpay, ...(typeof o.bitpay === 'object' && o.bitpay ? o.bitpay : {}) },
    coinbase: { ...base.coinbase, ...(typeof o.coinbase === 'object' && o.coinbase ? o.coinbase : {}) },
    coingecko: { ...base.coingecko, ...(typeof o.coingecko === 'object' && o.coingecko ? o.coingecko : {}) },
    kraken: { ...base.kraken, ...(typeof o.kraken === 'object' && o.kraken ? o.kraken : {}) },
    bitstamp: { ...base.bitstamp, ...(typeof o.bitstamp === 'object' && o.bitstamp ? o.bitstamp : {}) },
    gemini: { ...base.gemini, ...(typeof o.gemini === 'object' && o.gemini ? o.gemini : {}) },
    bitfinex: { ...base.bitfinex, ...(typeof o.bitfinex === 'object' && o.bitfinex ? o.bitfinex : {}) },
    binanceus: { ...base.binanceus, ...(typeof o.binanceus === 'object' && o.binanceus ? o.binanceus : {}) },
    coinmarketcap: {
      ...base.coinmarketcap,
      ...(typeof o.coinmarketcap === 'object' && o.coinmarketcap ? o.coinmarketcap : {})
    },
    utxoracle: { ...base.utxoracle, ...(typeof o.utxoracle === 'object' && o.utxoracle ? o.utxoracle : {}) }
  };
}

class Semaphore {
  constructor (max) {
    this.max = Math.max(1, Number(max) || 1);
    this.active = 0;
    /** @type {Array<() => void>} */
    this.queue = [];
  }

  async run (fn) {
    while (this.active >= this.max) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

class Feed extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      currency: 'BTC',
      quoteCurrency: 'USD',
      http: {
        bind: '0.0.0.0',
        host: 'localhost',
        port: 3000,
        secure: false,
        resources: {
          Quote: {
            name: 'Quote',
            components: {
              list: 'QuoteList',
              view: 'QuoteView'
            }
          }
        }
      },
      /** Fast ticker; outbound calls are additionally debounced on the Feed (`aggregation.debounceMs`). */
      interval: 22_000,
      fabric: null,
      sources: {
        bitpay: {},
        coinbase: {},
        coingecko: {},
        kraken: {},
        bitstamp: {},
        gemini: {},
        bitfinex: {},
        binanceus: {},
        coinmarketcap: {},
        utxoracle: {
          enabled: false
        }
      },
      /** Resolved to `['BTC']` after merge; this service only prices Bitcoin. */
      symbols: ['BTC'],
      sync: true,
      aggregation: {
        debounceMs: 12_000,
        /** Coalesce {@link Feed#commit} bursts before **`/quotes/stream`** snapshots (milliseconds). Set to {@code 0} for immediate fan-out. */
        streamBroadcastDebounceMs: 250,
        concurrency: {
          bitpay: 2,
          coinbase: 2,
          coingecko: 1,
          kraken: 1,
          bitstamp: 1,
          gemini: 1,
          bitfinex: 1,
          binanceus: 1,
          coinmarketcap: 1,
          utxoracle: 1
        }
      },
      persist: {
        path: './stores/feed-price',
        maxHistoryRows: 2048,
        meta: {},
        /** When true, **GET `/quotes/snapshot`** includes `priceHistory`. */
        exposePriceHistoryInReport: true
      },
      /**
       * Merged into {@link Bitcoin} via {@link mergeFeedBitcoinSettings}; shared by {@link UTXOracle}
       * and exposed as {@link Feed#bitcoin}. Set `zmq: false` to disable ZMQ subscription on managed nodes.
       */
      bitcoin: {},
      /**
       * When local `getblockchaininfo` fails, {@link UTXOracle#chainTipStatsForReport} can use Fabric Hub
       * Fabric Hub Bitcoin REST (`GET /blocks/:n` or `GET /blocks/height/:n` → hash). Set to `false` to disable.
       */
      chainHubFallback: {
        enabled: true,
        baseUrl: 'https://hub.fabric.pub'
      }
    }, this.settings, settings);

    this.settings.sources = normalizeFeedSources(this.settings.sources);
    this.settings.symbols = ['BTC'];

    this.peer = new Peer(this.settings.fabric ?? {});
    this.signer = new Key(this.settings.identity || {});

    this.bitpay = new BitPay({
      ...this.settings.sources.bitpay,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.coinbase = new Coinbase({
      ...this.settings.sources.coinbase,
      currency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.cmc = new CoinMarketCap({
      ...this.settings.sources.coinmarketcap,
      currency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.coingecko = new CoinGecko({
      ...this.settings.sources.coingecko,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.kraken = new Kraken({
      ...this.settings.sources.kraken,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.bitstamp = new Bitstamp({
      ...this.settings.sources.bitstamp,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.gemini = new Gemini({
      ...this.settings.sources.gemini,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.bitfinex = new Bitfinex({
      ...this.settings.sources.bitfinex,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    this.binanceus = new BinanceUS({
      ...this.settings.sources.binanceus,
      currency: this.settings.quoteCurrency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: this.settings.symbols,
      debug: this.settings.debug
    });

    const concurrency = Object.assign({
      bitpay: 2,
      coinbase: 2,
      coingecko: 1,
      kraken: 1,
      bitstamp: 1,
      gemini: 1,
      bitfinex: 1,
      binanceus: 1,
      coinmarketcap: 1,
      utxoracle: 1
    }, this.settings.aggregation?.concurrency ?? {});

    this.bitcoin = new Bitcoin(mergeFeedBitcoinSettings(this.settings));
    this.bitcoin.on('error', (error) => {
      const msg = (error && error.message) ? error.message : String(error);
      this.emit('warning', `[FEED:BITCOIN] ${msg}`);
    });

    this.utxoracle = new UTXOracle({
      ...this.settings.sources.utxoracle,
      bitcoinService: this.bitcoin,
      chainHubFallback: this.settings.chainHubFallback
    });

    this._registerQuoteProvidersFabric();

    // HTTP: Fabric-style resources (`/quotes`, `/sources`, `/blocks`, `/transactions`).
    const self = this;
    /** @returns {Promise<void>} */
    const json = (req, res, fn) => self.http.jsonOnly(req, res, fn);

    const handleQuotesSnapshot = (req, res) =>
      json(req, res, async () => {
        res.json(await self._buildReportPayload());
      });

    const handleQuotesSpot = (req, res) =>
      json(req, res, async () => {
        res.json(await self._latestSpotPayload());
      });

    const handleQuotesProviders = (req, res) =>
      json(req, res, async () => {
        res.json({
          quoteProviders: self._quoteProvidersReport()
        });
      });

    const handleQuotesHistory = (req, res) =>
      json(req, res, async () => {
        const q = req.query || {};
        const raw = q.limit != null && String(q.limit).trim() !== ''
          ? Number(q.limit)
          : NaN;
        const parsed = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MAX_QUOTE_HISTORY_DEFAULT;
        const limit = Math.max(1, Math.min(MAX_QUOTE_HISTORY_DEFAULT, parsed));
        const rows = this._historyRows.length > limit
          ? this._historyRows.slice(this._historyRows.length - limit)
          : this._historyRows.slice();
        res.json({ priceHistory: rows });
      });

    const handleQuotesChain = (req, res) =>
      json(req, res, async () => {
        const chain = await self._utxoracleChainPayload();
        res.json({ utxoracleChain: chain });
      });

    const handleQuotesSse = (req, res) => this.sse.handleHttp(req, res);


    /**
     * Resolve non-negative height → block hash via {@link Bitcoin#getBlockInfo}, then **302** Location.
     */
    const redirectBlockHeightToHash = (req, res, height) => {
      void (async () => {
        const num = typeof height === 'number' ? height : Number(height);
        if (!Number.isFinite(num) || num < 0 || num > Number.MAX_SAFE_INTEGER) {
          res.status(400).json({
            error: 'Invalid block height (non-negative integer required)'
          });
          return;
        }
        const h = Math.floor(num);
        try {
          const info = await self.bitcoin.getBlockInfo(h);
          const hash =
            info && info.hash != null ? String(info.hash).trim() : '';
          if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
            throw new Error('Bitcoin getBlockInfo returned no block hash');
          }
          res.redirect(302, `/blocks/${hash}`);
        } catch (e) {
          const msg =
            e && typeof e.message === 'string' ? e.message : String(e);
          res.status(404).json({ error: msg });
        }
      })();
    };

    const utxoracleEnabledForHttp = () =>
      self.settings.sources.utxoracle?.enabled === true ||
      self.utxoracle?.settings?.enabled === true;

    /** @param {import('http').IncomingMessage} req */
    const wantsBlocksEstimateSeriesQuery = (req) => {
      const q = req.query || {};
      return (
        Object.prototype.hasOwnProperty.call(q, 'minHeight') ||
        Object.prototype.hasOwnProperty.call(q, 'maxHeight') ||
        Object.prototype.hasOwnProperty.call(q, 'maxPoints')
      );
    };

    const handleBitcoinOracleEstimateSeriesInner = async (req, res) => {
      const enabled = utxoracleEnabledForHttp();
      if (!enabled) {
        res.status(503).json({
          error: 'UTXOracle is disabled for this feed'
        });
        return;
      }
      const q = req.query || {};
      const tip = await self.utxoracle._currentTipHeight();
      let minH =
        q.minHeight != null && String(q.minHeight).trim() !== ''
          ? Math.floor(Number(q.minHeight))
          : 0;
      let maxH =
        q.maxHeight != null && String(q.maxHeight).trim() !== ''
          ? Math.floor(Number(q.maxHeight))
          : tip != null && Number.isFinite(tip)
            ? tip
            : NaN;
      if (!Number.isFinite(maxH)) {
        res.status(400).json({
          error: 'Could not resolve chain tip; pass ?maxHeight=<block height>'
        });
        return;
      }
      if (!Number.isFinite(minH) || minH < 0) minH = 0;
      const maxPtsRaw =
        q.maxPoints != null && String(q.maxPoints).trim() !== ''
          ? Number(q.maxPoints)
          : 200;
      const parsedPts = Math.floor(Number(maxPtsRaw));
      const maxPoints = Math.max(
        1,
        Math.min(
          UTXO_HEIGHT_SERIES_MAX,
          Number.isFinite(parsedPts) && parsedPts > 0 ? parsedPts : 200
        )
      );
      try {
        const points = await self.utxoracle.estimateUsdHeightSeries(
          minH,
          maxH,
          maxPoints
        );
        res.json({ points });
      } catch (e) {
        const msg =
          typeof e?.message === 'string' ? e.message : String(e);
        res.status(400).json({ error: msg });
      }
    };

    const handleBitcoinOracleEstimateSeries = (req, res) =>
      json(req, res, () => handleBitcoinOracleEstimateSeriesInner(req, res));

    /**
     * Handle `GET /blocks?height=`:
     * - canonical path: resolve height -> hash then redirect to `/blocks/:hash`
     * - fallback path: when hash lookup is unavailable, return direct UTXOracle estimate payload
     *   so UI block replay remains usable in reduced local environments.
     */
    const handleBlocksHeightQuery = (req, res, rawHeight) =>
      json(req, res, async () => {
        const num =
          rawHeight != null && String(rawHeight).trim() !== ''
            ? Number(rawHeight)
            : NaN;
        if (!Number.isFinite(num) || num < 0) {
          res.status(400).json({
            error: 'Query ?height=<non-negative number> (block height) is required'
          });
          return;
        }
        const height = Math.floor(num);

        try {
          const info = await self.bitcoin.getBlockInfo(height);
          const hash =
            info && info.hash != null ? String(info.hash).trim() : '';
          if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
            throw new Error('Bitcoin getBlockInfo returned no block hash');
          }
          res.redirect(302, `/blocks/${hash}`);
          return;
        } catch (_) {
          // Fallback below.
        }

        if (!utxoracleEnabledForHttp()) {
          res.status(503).json({
            error:
              'Block hash lookup unavailable and UTXOracle is disabled for this feed'
          });
          return;
        }
        try {
          const out = await self.utxoracle.estimateUsdAtHeight(height);
          res.status(200).json(out);
        } catch (e) {
          const msg =
            typeof e?.message === 'string' ? e.message : String(e);
          res.status(400).json({ error: msg });
        }
      });

    /**
     * `GET /blocks` discovery, height → hash redirect (**302**), or UTXOracle height series (**query**
     * `minHeight`, `maxHeight`, `maxPoints`).
     */
    const handleBlocksRoot = (req, res) => {
      if (wantsBlocksEstimateSeriesQuery(req)) {
        return handleBitcoinOracleEstimateSeries(req, res);
      }
      const qh = req.query && req.query.height;
      const qblock = req.query && req.query.block;
      const raw = qh ?? qblock;
      if (raw != null && String(raw).trim() !== '') {
        handleBlocksHeightQuery(req, res, raw);
        return;
      }
      json(req, res, async () => {
        const host =
          typeof req.headers?.host === 'string' ? req.headers.host.trim() : '';
        const proto =
          req.socket && /** @type {{ encrypted?: boolean }} */ (req.socket).encrypted === true
            ? 'https'
            : 'http';
        res.status(200).json({
          '@type': 'BitcoinBlocksResource',
          description:
            'Block metadata and UTXOracle USD/BTC estimates. Use GET /blocks/{hash} ' +
            '(canonical), GET /blocks/{height} redirects to GET /blocks/{hash}, or estimate ' +
            'series via ?minHeight=&maxHeight=&maxPoints=.',
          ...(host !== '' ? { endpoint: `${proto}://${host}/blocks` } : {}),
          canonicalBlockPattern: '/blocks/{block-hash-hex}',
          heightRedirectsToCanonicalHash: '/blocks/{decimal-height}',
          oracleEstimateSeriesQuery:
            '?minHeight={n}&maxHeight={n}&maxPoints={n}'
        });
      });
    };

    /** `GET /blocks/:id` — decimal **height** redirects; **64-hex hash** JSON with optional `utxoracle`. */
    const handleBlockByPathId = (req, res) => {
      const seg =
        req.params && req.params.id !== undefined
          ? String(req.params.id).trim()
          : '';
      if (!seg) {
        res.status(400).json({ error: 'Missing block id' });
        return;
      }
      if (/^[0-9]+$/.test(seg)) {
        redirectBlockHeightToHash(req, res, Number(seg));
        return;
      }
      if (!/^[0-9a-fA-F]{64}$/.test(seg)) {
        res.status(400).json({
          error: 'Expected block hash (64 hex characters) or decimal block height'
        });
        return;
      }
      const hash = seg.toLowerCase();
      json(req, res, async () => {
        let blockCore;
        try {
          blockCore = await self.bitcoin.getBlockInfo(hash);
        } catch (e) {
          const msg =
            e && typeof e.message === 'string' ? e.message : String(e);
          res.status(404).json({ error: msg });
          return;
        }
        /** @type {Record<string, unknown>} */
        const out = {
          ...blockCore
        };
        if (utxoracleEnabledForHttp()) {
          const h =
            blockCore && blockCore.height != null
              ? Math.floor(Number(blockCore.height))
              : NaN;
          if (Number.isFinite(h) && h >= 0) {
            try {
              out.utxoracle = await self.utxoracle.estimateUsdAtHeight(h);
            } catch (e) {
              out.utxoracle = {
                error:
                  typeof e?.message === 'string' ? e.message : String(e)
              };
            }
          } else {
            out.utxoracle = null;
          }
        } else {
          out.utxoracle = null;
        }
        res.json(out);
      });
    };

    /** `GET /blocks/height/:height` redirects to canonical **`/blocks/:hash`**. */
    const handleBitcoinBlockLegacyHeightSegment = (req, res) => {
      const raw =
        req.params && req.params.height !== undefined
          ? String(req.params.height).trim()
          : '';
      if (!raw) {
        res.status(400).json({ error: 'Missing block height' });
        return;
      }
      redirectBlockHeightToHash(req, res, Number(raw));
    };

    const handleBitcoinTransaction = (req, res) =>
      json(req, res, async () => {
        const raw =
          req.params && req.params.txid !== undefined ? String(req.params.txid) : '';
        const txid = raw.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
          res.status(400).json({
            error: 'Invalid transaction id (64-character hex txid required)'
          });
          return;
        }
        try {
          const tx = await self.bitcoin.getTransactionInfo(txid.toLowerCase());
          res.status(200).json(tx);
        } catch (e) {
          const msg =
            e && typeof e.message === 'string' ? e.message : String(e);
          res.status(404).json({ error: msg });
        }
      });

    const handleSourcesCollection = (req, res) =>
      json(req, res, async () => {
        res.json({
          '@type': 'Collection',
          currency: self.currency,
          quoteCurrency: self.settings.quoteCurrency,
          quoteProviders: self._quoteProvidersReport()
        });
      });

    const handleSourcesItem = (req, res) =>
      json(req, res, async () => {
        const id =
          req.params && req.params.id != null ? String(req.params.id) : '';
        if (!id) {
          res.status(400).json({ error: 'Missing source id' });
          return;
        }
        const rows = self._quoteProvidersReport();
        const row = rows.find((p) => p && String(p.id) === id);
        if (!row) {
          res.status(404).json({ error: `Unknown source: ${id}` });
          return;
        }
        res.json(row);
      });

    /**
     * Canonical HTTP routes.
     * @type {Array<{ method: string, path: string, handler: Function }>}
     */
    const feedHttpRoutes = [
      { method: 'get', path: '/quotes/snapshot', handler: handleQuotesSnapshot },
      { method: 'get', path: '/quotes/spot', handler: handleQuotesSpot },
      { method: 'get', path: '/quotes/providers', handler: handleQuotesProviders },
      { method: 'get', path: '/quotes/history', handler: handleQuotesHistory },
      { method: 'get', path: '/quotes/chain', handler: handleQuotesChain },
      { method: 'get', path: QUOTES_SSE_PATH, handler: handleQuotesSse },

      { method: 'get', path: '/blocks', handler: handleBlocksRoot },
      {
        method: 'get',
        path: '/blocks/height/:height',
        handler: handleBitcoinBlockLegacyHeightSegment
      },
      { method: 'get', path: '/blocks/:id', handler: handleBlockByPathId },

      {
        method: 'get',
        path: '/transactions/:txid',
        handler: handleBitcoinTransaction
      },

      { method: 'get', path: '/sources', handler: handleSourcesCollection },
      { method: 'get', path: '/sources/:id', handler: handleSourcesItem }
    ];

    const httpSettings = Object.assign({}, this.settings.http);
    httpSettings.routes = [].concat(httpSettings.routes || [], feedHttpRoutes);

    this.http = new HTTPServer(httpSettings);

    this._quoteCache = new Map();
    this._quoteLimiters = {};
    const limDefaults = {
      bitpay: 2,
      coinbase: 2,
      coingecko: 1,
      kraken: 1,
      bitstamp: 1,
      gemini: 1,
      bitfinex: 1,
      binanceus: 1,
      coinmarketcap: 1,
      utxoracle: 1
    };
    for (const k of Object.keys(limDefaults)) {
      const n =
        typeof concurrency[k] === 'number' && Number.isFinite(concurrency[k])
          ? concurrency[k]
          : limDefaults[k];
      this._quoteLimiters[k] = new Semaphore(n);
    }

    this._quoteDebounceMs =
      this.settings.aggregation?.debounceMs != null
        ? this.settings.aggregation.debounceMs
        : 10_000;

    this.persistence = new FeedPriceStore({
      path: this.settings.persist?.path,
      snapshotKey: this.settings.persist?.snapshotKey,
      verbosity: this.settings.debug ? 2 : 0
    });

    /** @type {Array<{ ts: number, values: Record<string, unknown> }>} */
    this._historyRows = [];

    /** @type {import('ws').WebSocketServer|null} */
    this._feedReportWss = null;
    /** @type {Set<import('ws').WebSocket>} */
    this._feedStreamClients = new Set();
    this.sse = new SSEService({
      eventName: 'quotes',
      heartbeatMs: 15_000,
      retryMs: 10_000,
      snapshotProvider: async () => {
        return this._buildReportPayload();
      }
    });
    /** @type {Array<(...args: unknown[]) => void>|null} */
    this._feedStreamUpgradePrevious = null;
    this._onFeedStreamHttpUpgrade = this._onFeedStreamHttpUpgrade.bind(this);
    this._feedBitcoinStarted = false;
    this._bitcoinStreamAttached = false;
    this._onBitcoinBlockForStream = this._onBitcoinBlockForStream.bind(this);
    this._onBitcoinZmqFabricMessage = this._onBitcoinZmqFabricMessage.bind(this);

    // Timer
    this._syncService = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._commitBroadcastTimer = null;

    // Internal State
    this._state = {
      content: {
        values: {}
      },
      history: [],
      states: {},
      quotes: {},
      status: 'PAUSED'
    };
  }

  get currency () {
    return this.settings.currency;
  }

  get values () {
    return this.state.values;
  }

  /**
   * Register quote sources as Fabric {@link Service#services} entries and {@link Resource}
   * definitions (mirrored under {@code settings.http.resources} for the HTTP shell).
   */
  _registerQuoteProvidersFabric () {
    this.services.bitpay = this.bitpay;
    this.services.coinbase = this.coinbase;
    this.services.coingecko = this.coingecko;
    this.services.kraken = this.kraken;
    this.services.bitstamp = this.bitstamp;
    this.services.gemini = this.gemini;
    this.services.bitfinex = this.bitfinex;
    this.services.binanceus = this.binanceus;
    this.services.coinmarketcap = this.cmc;
    this.services.utxoracle = this.utxoracle;

    this.settings.services = [].concat(PROVIDER_IDS);

    const httpResources =
      typeof this.settings.http.resources === 'object' && this.settings.http.resources
        ? this.settings.http.resources
        : {};
    this.settings.http.resources = httpResources;

    for (let i = 0; i < PROVIDER_IDS.length; i++) {
      const id = PROVIDER_IDS[i];
      const label = PROVIDER_LABELS[id];
      const resourceKey = quoteProviderResourceKey(id);
      const components = {
        list: `quote-provider-${id}-list`,
        view: `quote-provider-${id}-view`
      };

      this._defineResource(resourceKey, {
        name: label,
        components
      });

      httpResources[resourceKey] = {
        name: label,
        components
      };
    }

    /** @type {Record<string, { lastError: string|null, lastErrorAt: number|null, lastSuccessAt: number|null, quotesBySymbol: Record<string, object>, rateLimitStreak: number, nextAttemptAt: number|null }>} */
    this._providerTelemetry = {};
    for (let j = 0; j < PROVIDER_IDS.length; j++) {
      const id = PROVIDER_IDS[j];
      this._providerTelemetry[id] = {
        lastError: null,
        lastErrorAt: null,
        lastSuccessAt: null,
        quotesBySymbol: {},
        rateLimitStreak: 0,
        nextAttemptAt: null,
        lastTls: null
      };
    }

    this._tlsTelemetryBound = (serviceId, url, tls) => {
      const tel = this._providerTelemetry[serviceId];
      if (!tel || !tls || typeof tls !== 'object') return;
      /** @type {{ authorized?: unknown, rejected?: unknown }} */
      const snap = tls;
      if (snap.rejected === true) return;
      if (snap.authorized !== true) return;
      tel.lastTls = { ...tls, url, capturedAt: Date.now() };
    };
    setTlsTelemetryHook(this._tlsTelemetryBound);
  }

  _providerEnabled (id) {
    if (id === 'coinmarketcap') {
      return isConfiguredCoinmarketcapKey(
        this.settings.sources.coinmarketcap?.key
      );
    }
    if (id === 'utxoracle') {
      return (
        this.settings.sources.utxoracle?.enabled === true ||
        this.utxoracle?.settings?.enabled === true
      );
    }
    if (
      id === 'coingecko' ||
      id === 'kraken' ||
      id === 'bitstamp' ||
      id === 'gemini' ||
      id === 'bitfinex' ||
      id === 'binanceus'
    ) {
      return this.settings.sources[id]?.enabled !== false;
    }
    return true;
  }

  _quoteProvidersReport () {
    const out = [];
    const now = Date.now();
    const reportSymbol = 'BTC';
    for (let i = 0; i < PROVIDER_IDS.length; i++) {
      const id = PROVIDER_IDS[i];
      const svc = this.services[id];
      const tel = this._providerTelemetry[id];
      const resourceKey = quoteProviderResourceKey(id);
      const fabricResource = this.resources[resourceKey];
      const cacheRow = this._quoteCache.get(this._quoteCacheKey(id, reportSymbol));
      const debounceUntil =
        cacheRow && typeof cacheRow.fetchedAt === 'number'
          ? cacheRow.fetchedAt + this._quoteDebounceMs
          : null;
      const throttleUntil =
        tel &&
        typeof tel.nextAttemptAt === 'number' &&
        Number.isFinite(tel.nextAttemptAt)
          ? tel.nextAttemptAt
          : null;
      const waits = [debounceUntil, throttleUntil].filter(
        (t) => typeof t === 'number' && Number.isFinite(t) && t > now
      );
      const nextFetchAt = waits.length ? Math.max(...waits) : null;
      out.push({
        id,
        label: PROVIDER_LABELS[id] || id,
        enabled: this._providerEnabled(id),
        resource: fabricResource
          ? {
              key: resourceKey,
              name: fabricResource.name,
              routes: fabricResource.routes
                ? { ...fabricResource.routes }
                : undefined
            }
          : null,
        service:
          svc && typeof svc === 'object'
            ? {
                id: svc.id,
                status: svc.status
              }
            : null,
        lastError: tel?.lastError ?? null,
        lastErrorAt: tel?.lastErrorAt ?? null,
        lastSuccessAt: tel?.lastSuccessAt ?? null,
        nextFetchAt,
        quotesBySymbol:
          tel?.quotesBySymbol && typeof tel.quotesBySymbol === 'object'
            ? { ...tel.quotesBySymbol }
            : {},
        lastTls: tel?.lastTls ?? null
      });
    }
    return out;
  }

  _touchProviderSuccess (provider, symbol, quote, fromCache, meta = {}) {
    const tel = this._providerTelemetry[provider];
    if (!tel || !quote || typeof quote !== 'object') return;
    if (!fromCache) {
      tel.rateLimitStreak = 0;
      tel.nextAttemptAt = null;
    }
    tel.lastError = null;
    tel.lastSuccessAt = Date.now();
    let created = quote.created;
    if (created instanceof Date) {
      created = created.toISOString();
    } else if (created != null) {
      created = String(created);
    } else {
      created = null;
    }
    tel.quotesBySymbol[symbol] = {
      price: quote.price,
      currency: quote.currency,
      age: quote.age,
      created,
      fromCache: !!fromCache,
      ...(typeof quote.asOfMs === 'number' && Number.isFinite(quote.asOfMs)
        ? { asOfMs: Math.round(quote.asOfMs) }
        : {}),
      ...(quote.asOfSource != null
        ? { asOfSource: String(quote.asOfSource) }
        : {}),
      ...(meta.excludedFromSpot === true ? { excludedFromSpot: true } : {})
    };
  }

  _touchProviderError (provider, err) {
    const tel = this._providerTelemetry[provider];
    if (!tel) return;
    tel.lastError = err?.message || String(err);
    tel.lastErrorAt = Date.now();
    if (Worker.errorIndicatesRateLimit(err)) {
      tel.rateLimitStreak = (tel.rateLimitStreak || 0) + 1;
      tel.nextAttemptAt = Date.now() + Worker.rateLimitBackoffMs(tel.rateLimitStreak);
    }
  }

  commit () {
    const state = new Actor(this.state);
    this._state.states[state.id] = state.toObject();
    this._state.history.push(state.id);

    if (this.observer) {
      try {
        const patches = generateObserverPatches(this.observer);
        if (patches.length) {
          this.history.push(patches);
          this.emit('patches', patches);
        }
      } catch (E) {
        console.error('Could not generate patches:', E);
      }
    }

    const commit = new Actor({
      type: 'Commit',
      state: this.state
    });

    this.emit('commit', { ...commit.toObject(), id: commit.id });

    this._scheduleBroadcastAfterCommit();

    return commit.id;
  }

  /**
   * Schedule a snapshot of {@link #_buildReportPayload} for every subscriber on `/quotes/stream`.
   * so WebSocket observers stay aligned with Fabric {@link #commit} snapshots (debounced).
   */
  _scheduleBroadcastAfterCommit () {
    if (
      this._feedStreamClients.size === 0 &&
      !this.sse.hasClients()
    ) {
      return;
    }
    const raw = this.settings.aggregation?.streamBroadcastDebounceMs;
    const ms =
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
        ? Math.floor(raw)
        : 250;
    if (this._commitBroadcastTimer) {
      clearTimeout(this._commitBroadcastTimer);
      this._commitBroadcastTimer = null;
    }
    if (ms === 0) {
      void this._broadcastFeedReportToSubscribers();
      return;
    }
    this._commitBroadcastTimer = setTimeout(() => {
      this._commitBroadcastTimer = null;
      void this._broadcastFeedReportToSubscribers();
    }, ms);
  }

  /**
   * Time-weighted average over latest per-provider quotes.
   * Newer quotes receive higher weight via inverse quote age in milliseconds.
   * Invalid numeric entries are skipped so one bad provider does not poison the aggregate.
   * @param {Array<{ price?: unknown, age?: unknown, asOfMs?: unknown }>} quotes
   */
  estimateFromQuotes (quotes) {
    if (!quotes?.length) throw new Error('No quotes provided.');

    let estimate = null;

    switch (ESTIMATE_MODE) {
      case 'weighted': {
        let mass = 0;
        let sum = 0;

        for (const quote of quotes) {
          const price = Number(quote?.price);
          if (!Number.isFinite(price)) continue;

          const asOf = quoteAsOfMs(quote);
          let ageMs;
          if (Number.isFinite(asOf)) {
            ageMs = Math.max(1, Date.now() - asOf);
          } else {
            const ageRaw = Number(quote?.age);
            ageMs =
              Number.isFinite(ageRaw) && ageRaw > 0 ? ageRaw : 1;
          }
          const weight = 1 / Math.max(ageMs, 1e-9);
          const value = weight * price;

          mass += weight;
          sum += value;
        }

        if (mass <= 0 || !Number.isFinite(sum)) {
          throw new Error('No valid quotes for weighted estimate.');
        }

        estimate = sum / mass;
        break;
      }
      case 'average': {
        const prices = quotes
          .map((quote) => Number(quote?.price))
          .filter((p) => Number.isFinite(p));
        if (!prices.length) throw new Error('No valid quotes for average estimate.');
        estimate =
          prices.reduce((s, value) => s + value, 0) / prices.length;
        break;
      }
      default:
        throw new Error(`Unsupported ESTIMATE_MODE: ${ESTIMATE_MODE}`);
    }

    return estimate;
  }

  trust (source, name = source.constructor.name) {
    super.trust(source);

    const self = this;

    source.on('quote', function handleSourceQuote (quote) {
      const actor = new Actor({
        type: 'Quote',
        data: {
          ...quote,
          source: name
        }
      });

      self._state.quotes[actor.id] = actor.toObject();
      self.commit();
    });

    return this;
  }

  async generateReport () {
    const report = await this._latestData();
    const { priceHistory: _hist, ...reportForAttestation } = report;
    const string = JSON.stringify(reportForAttestation, null, '  ');
    // TODO: consider reverting to raw buffer
    const buffer = string || Buffer.from(string, 'utf8');
    const preimage = Hash256.digest(buffer);
    const digestBuf = Buffer.from(preimage, 'hex');
    const signature = this.signer.signSchnorrHash(digestBuf);
    const valid = this.signer.verifySchnorrHash(digestBuf, signature);
    const pubkeyHex =
      this.signer.public && typeof this.signer.public.encodeCompressed === 'function'
        ? this.signer.public.encodeCompressed('hex')
        : null;

    // Construct the report
    return {
      ...report,
      attestation: {
        content: buffer,
        preimage: preimage,
        pubkey: pubkeyHex,
        signature: signature,
        valid: valid
      }
    };
  }

  async getAssetForSymbol (symbol) {
    if (String(symbol || '').toUpperCase() !== 'BTC') {
      throw new Error('Only BTC is supported.');
    }
    return this.cmc.getAssetForSymbol(symbol);
  }

  async getQuoteForSymbol (symbol) {
    if (String(symbol || '').toUpperCase() !== 'BTC') {
      throw new Error('Only BTC is supported.');
    }
    const { fulfilled, cacheAgeMs } =
      await this._fetchProviderQuotes(symbol);

    const quotesForWeight = [];
    for (const entry of fulfilled) {
      if (!entry || !entry.quote) continue;
      if (entry.excludedFromSpot === true) continue;
      const price = Number(entry.quote.price);
      if (!Number.isFinite(price)) continue;
      const asOf = quoteAsOfMs(entry.quote);
      if (!Number.isFinite(asOf)) continue;
      quotesForWeight.push({ price, asOfMs: asOf });
    }

    if (!quotesForWeight.length) {
      /** @type {Record<string, number>} */
      const ageMapEmpty =
        typeof cacheAgeMs === 'object' && cacheAgeMs ? cacheAgeMs : {};
      const sources = fulfilled.map((entry) =>
        this._serializeSourceEntry(symbol, entry, ageMapEmpty));
      return {
        price: null,
        sourceCount: 0,
        sources
      };
    }

    /** @type {Record<string, number>} */
    const ageMap =
      typeof cacheAgeMs === 'object' && cacheAgeMs ? cacheAgeMs : {};

    const sources = fulfilled.map((entry) =>
      this._serializeSourceEntry(symbol, entry, ageMap));

    return {
      price: this.estimateFromQuotes(quotesForWeight),
      sourceCount: quotesForWeight.length,
      sources
    };
  }

  /**
   * @param {Record<string, number>} cacheAgeMs
   */
  _serializeSourceEntry (symbol, entry, cacheAgeMs) {
    const q = entry.quote || {};
    let created = q.created;
    if (created instanceof Date) {
      created = created.toISOString();
    } else if (created != null) {
      created = String(created);
    }

    const key = `${entry.provider}:${symbol}`;

    /** @type {{
     *   provider: string,
     *   label: string,
     *   price: unknown,
     *   age?: unknown,
     *   currency?: unknown,
     *   fromCache?: boolean,
     *   created?: string|null,
     *   asOfMs?: number,
     *   asOfSource?: string,
     *   cacheAgeMs?: number
     * }} */
    const fromBrokerCache = !!entry.fromCache;
    const fromOracleHeight =
      !!(q.fromChainCache === true || q.fromHeightCache === true);

    const asOfRounded =
      typeof q.asOfMs === 'number' && Number.isFinite(q.asOfMs)
        ? Math.round(q.asOfMs)
        : undefined;

    const row = {
      provider: entry.provider,
      label: PROVIDER_LABELS[entry.provider] || entry.provider,
      price: q.price,
      age: q.age,
      currency: q.currency,
      fromCache: fromBrokerCache || fromOracleHeight,
      created: created || null,
      ...(asOfRounded !== undefined ? { asOfMs: asOfRounded } : {}),
      ...(q.asOfSource != null && String(q.asOfSource).trim() !== ''
        ? { asOfSource: String(q.asOfSource) }
        : {})
    };

    if (
      typeof cacheAgeMs[key] === 'number' &&
      Number.isFinite(cacheAgeMs[key])
    ) {
      row.cacheAgeMs = cacheAgeMs[key];
    }

    if (entry.excludedFromSpot === true) {
      row.excludedFromSpot = true;
    }

    return row;
  }

  _quoteCacheKey (provider, symbol) {
    return `${provider}:${symbol}`;
  }

  _quoteHitCache (provider, symbol) {
    const row = this._quoteCache.get(this._quoteCacheKey(provider, symbol));
    const now = Date.now();
    if (!row) return null;
    if ((now - row.fetchedAt) >= this._quoteDebounceMs) return null;
    return row.quote;
  }

  /** Last cached quote for `provider`+`symbol`, regardless of debounce (for rate-limit backoff). */
  _quoteStaleCacheRow (provider, symbol) {
    return this._quoteCache.get(this._quoteCacheKey(provider, symbol)) ?? null;
  }

  async _quoteRefreshCache (provider, symbol, supplier) {
    return this._quoteLimiters[provider].run(async () => {
      const warmed = this._quoteHitCache(provider, symbol);
      if (warmed) return warmed;

      const quote = await supplier();
      this._quoteCache.set(this._quoteCacheKey(provider, symbol), {
        quote,
        fetchedAt: Date.now()
      });
      return quote;
    });
  }

  /**
   * Serialized outbound quote fetches with per-provider concurrency and debounced cache.
   * @returns {{
   *   fulfilled: Array<{ quote: object, provider: string, fromCache?: boolean }>,
   *   cacheAgeMs: Record<string, number>
   * }}
   */
  async _fetchProviderQuotes (symbol) {
    const cacheAgeMs = {};

    const utxOracleOn =
      symbol === 'BTC' &&
      (this.settings.sources.utxoracle?.enabled === true ||
        (this.utxoracle &&
          this.utxoracle.settings &&
          this.utxoracle.settings.enabled === true));

    let utxChainReady = false;
    if (utxOracleOn) {
      utxChainReady =
        typeof this.utxoracle.isChainReadyForAggregation === 'function'
          ? await this.utxoracle.isChainReadyForAggregation()
          : false;
    }

    const single = async (provider, supplier) => {
      const telPre = this._providerTelemetry[provider];
      const nowMs = Date.now();
      const nextAt =
        telPre &&
        typeof telPre.nextAttemptAt === 'number' &&
        Number.isFinite(telPre.nextAttemptAt)
          ? telPre.nextAttemptAt
          : null;

      const utxMeta =
        utxOracleOn && provider === 'utxoracle'
          ? { excludedFromSpot: !utxChainReady }
          : {};

      const hit = this._quoteHitCache(provider, symbol);
      if (hit) {
        const row = this._quoteCache.get(this._quoteCacheKey(provider, symbol));
        if (row?.fetchedAt) {
          cacheAgeMs[this._quoteCacheKey(provider, symbol)] =
            Date.now() - row.fetchedAt;
        }
        this._touchProviderSuccess(provider, symbol, hit, true, utxMeta);
        return { provider, quote: hit, fromCache: true };
      }

      if (nextAt != null && nowMs < nextAt) {
        const staleRow = this._quoteStaleCacheRow(provider, symbol);
        const stale = staleRow?.quote ?? null;
        if (stale) {
          const fetchedAt = staleRow.fetchedAt;
          if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)) {
            cacheAgeMs[this._quoteCacheKey(provider, symbol)] = nowMs - fetchedAt;
          }
          this._touchProviderSuccess(provider, symbol, stale, true, utxMeta);
          return { provider, quote: stale, fromCache: true };
        }
        return null;
      }

      try {
        const quote = await this._quoteRefreshCache(provider, symbol, supplier);
        this._touchProviderSuccess(provider, symbol, quote, false, utxMeta);
        return { provider, quote, fromCache: false };
      } catch (err) {
        const staleRow = this._quoteStaleCacheRow(provider, symbol);
        const stale = staleRow?.quote ?? null;
        if (stale) {
          const fetchedAt = staleRow.fetchedAt;
          if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)) {
            cacheAgeMs[this._quoteCacheKey(provider, symbol)] = Date.now() - fetchedAt;
          }
          this._touchProviderSuccess(provider, symbol, stale, true, utxMeta);
          return { provider, quote: stale, fromCache: true };
        }
        this._touchProviderError(provider, err);
        return null;
      }
    };

    /** @type {Promise<{ provider: string, quote: object, fromCache?: boolean, excludedFromSpot?: boolean }|null>[]} */
    const tasks = [
      single('bitpay', () => this.bitpay.getQuoteForSymbol(symbol)),
      single('coinbase', () => this.coinbase.getQuoteForSymbol(symbol))
    ];

    if (this._providerEnabled('coingecko')) {
      tasks.push(
        single('coingecko', () => this.coingecko.getQuoteForSymbol(symbol))
      );
    }
    if (this._providerEnabled('kraken')) {
      tasks.push(
        single('kraken', () => this.kraken.getQuoteForSymbol(symbol))
      );
    }
    if (this._providerEnabled('bitstamp')) {
      tasks.push(
        single('bitstamp', () => this.bitstamp.getQuoteForSymbol(symbol))
      );
    }
    if (this._providerEnabled('gemini')) {
      tasks.push(
        single('gemini', () => this.gemini.getQuoteForSymbol(symbol))
      );
    }
    if (this._providerEnabled('bitfinex')) {
      tasks.push(
        single('bitfinex', () => this.bitfinex.getQuoteForSymbol(symbol))
      );
    }
    if (this._providerEnabled('binanceus')) {
      tasks.push(
        single('binanceus', () => this.binanceus.getQuoteForSymbol(symbol))
      );
    }

    if (isConfiguredCoinmarketcapKey(this.settings.sources.coinmarketcap?.key)) {
      tasks.push(
        single('coinmarketcap', () =>
          this.cmc.getQuoteForSymbol(symbol))
      );
    }

    if (utxOracleOn) {
      tasks.push(
        single('utxoracle', () => this.utxoracle.getQuoteForSymbol(symbol))
      );
    }

    const parts = await Promise.all(tasks);
    const flagged = parts.map((x) => {
      if (!x || x.provider !== 'utxoracle' || !utxOracleOn) return x;
      return { ...x, excludedFromSpot: !utxChainReady };
    });
    const fulfilled = /** @type {Array<{ provider: string, quote: object, fromCache?: boolean, excludedFromSpot?: boolean }>} */ (
      flagged.filter((x) => x && x.quote));

    return { fulfilled, cacheAgeMs };
  }

  _dehydrateQuoteCache () {
    const snap = {};
    for (const [k, row] of this._quoteCache.entries()) {
      snap[k] = {
        fetchedAt: row.fetchedAt,
        quote: row.quote
      };
    }
    return snap;
  }

  _hydrateQuoteCache (snap) {
    this._quoteCache.clear();
    if (!snap || typeof snap !== 'object') return;
    for (const [k, v] of Object.entries(snap)) {
      if (
        v &&
        typeof v === 'object' &&
        typeof v.fetchedAt === 'number' &&
        v.quote
      ) {
        this._quoteCache.set(k, {
          fetchedAt: v.fetchedAt,
          quote: v.quote
        });
      }
    }
  }

  _captureHistorySlice (aggregateValues, maxHist) {
    /** Skip duplicate snapshots (e.g. interval {@link #_sync} + debounced WS broadcast). */
    const btc = aggregateValues && aggregateValues.BTC;
    const lastRow = this._historyRows.length ? this._historyRows[this._historyRows.length - 1] : null;
    if (
      lastRow &&
      btc &&
      typeof btc.price === 'number' &&
      Number.isFinite(btc.price) &&
      lastRow.values &&
      lastRow.values.BTC &&
      typeof lastRow.values.BTC.price === 'number'
    ) {
      const lp = Number(lastRow.values.BTC.price);
      const np = Number(btc.price);
      if (
        Number.isFinite(lp) &&
        Number.isFinite(np) &&
        Math.abs(lp - np) < 1e-12 &&
        Date.now() - lastRow.ts < 1500
      ) {
        return;
      }
    }

    const row = {
      id: randomUUID(),
      ts: Date.now(),
      schema: 2,
      values: JSON.parse(JSON.stringify(aggregateValues))
    };

    this._historyRows.push(row);

    while (this._historyRows.length > maxHist) {
      this._historyRows.shift();
    }
  }

  async syncAllPrices () {
    await this.persistence.open().catch(() => {});

    const maxHistRaw = this.settings.persist?.maxHistoryRows;
    const maxHist =
      typeof maxHistRaw === 'number' ? Math.floor(maxHistRaw) : 2048;

    /** @type {Record<string, { price?: number|null, sourceCount?: number, sources?: unknown[] }>} */
    const nextValues = {};

    const quote = await this.getQuoteForSymbol('BTC');
    if (quote?.price != null && Number.isFinite(quote.price)) {
      nextValues.BTC = {
        price: quote.price,
        sourceCount: quote.sourceCount != null ? quote.sourceCount : 0,
        sources:
          Array.isArray(quote.sources) ? quote.sources.slice() : []
      };
    }

    if (!Object.keys(nextValues).length) {
      return this._state.content.values;
    }

    const tgt = this._state.content.values;
    for (const symbol of Object.keys(nextValues)) {
      Reflect.set(tgt, symbol, nextValues[symbol]);
    }

    this._captureHistorySlice(nextValues, maxHist);

    await this.persistence.save({
      values: { ...tgt },
      brokerCache: this._dehydrateQuoteCache(),
      historyRows: this._historyRows.slice(),
      meta: {
        ...(this.settings.persist?.meta &&
        typeof this.settings.persist.meta === 'object'
          ? this.settings.persist.meta
          : {}),
        lastSyncAt: Date.now()
      }
    });

    return tgt;
  }

  async start () {
    if (this.status === 'STARTED') return this;
    this._state.status = 'STARTING';

    this.trust(this.bitpay, 'bitpay');
    this.trust(this.coinbase, 'coinbase');
    if (this._providerEnabled('coingecko')) {
      this.trust(this.coingecko, 'coingecko');
    }
    if (this._providerEnabled('kraken')) {
      this.trust(this.kraken, 'kraken');
    }
    if (this._providerEnabled('bitstamp')) {
      this.trust(this.bitstamp, 'bitstamp');
    }
    if (this._providerEnabled('gemini')) {
      this.trust(this.gemini, 'gemini');
    }
    if (this._providerEnabled('bitfinex')) {
      this.trust(this.bitfinex, 'bitfinex');
    }
    if (this._providerEnabled('binanceus')) {
      this.trust(this.binanceus, 'binanceus');
    }
    this.trust(this.cmc, 'coinmarketcap');
    if (this.utxoracle.settings?.enabled === true) {
      this.trust(this.utxoracle, 'utxoracle');
    }

    await this.persistence.open();
    const loaded = await this.persistence.load();

    const maxHistRaw = this.settings.persist?.maxHistoryRows;
    const maxHist =
      typeof maxHistRaw === 'number' ? Math.floor(maxHistRaw) : 2048;

    if (loaded?.values && typeof loaded.values === 'object') {
      Object.assign(this._state.content.values, loaded.values);
    }

    if (loaded?.brokerCache) {
      this._hydrateQuoteCache(loaded.brokerCache);
    }

    if (loaded?.historyRows && Array.isArray(loaded.historyRows)) {
      const rows = loaded.historyRows;
      const offset = rows.length <= maxHist ? 0 : rows.length - maxHist;
      this._historyRows = rows.slice(offset);
    }

    // Start HTTP Service
    await this.http.start();
    this._installFeedReportWebSocket();

    const utxoOracleOn =
      this.settings.sources.utxoracle?.enabled === true ||
      this.utxoracle?.settings?.enabled === true;
    if (utxoOracleOn) {
      try {
        await this.bitcoin.start();
        this._feedBitcoinStarted = true;
        this._attachBitcoinStreamEvents();
      } catch (error) {
        const msg = (error && error.message) ? error.message : String(error);
        this.emit('warning', `[FEED:BITCOIN] start() unavailable: ${msg}`);
        this._feedBitcoinStarted = false;
      }
    }

    // If Fabric enabled, start
    if (this.settings.fabric) {
      await this.peer.start();
    }

    // If sync enabled, start
    if (this.settings.sync) {
      await this._sync();
      this._syncService = setInterval(async () => {
        await this._sync();
      }, FEED_QUOTE_TICK_MS);
    }

    this._state.status = 'STARTED';
    this.commit();
    return this;
  }

  async stop () {
    setTlsTelemetryHook(null);
    if (this._syncService) {
      clearInterval(this._syncService);
      this._syncService = null;
    }
    await this._stopFeedReportStream();
    await this.http.stop();

    if (this.settings.fabric && typeof this.peer?.stop === 'function') {
      try {
        await this.peer.stop();
      } catch {
        /* best-effort */
      }
    }

    try {
      await this.persistence.open().catch(() => {});
      await this.persistence.save({
        values: { ...this._state.content.values },
        brokerCache: this._dehydrateQuoteCache(),
        historyRows: this._historyRows.slice(),
        meta: {
          ...(this.settings.persist?.meta &&
          typeof this.settings.persist.meta === 'object'
            ? this.settings.persist.meta
            : {}),
          stoppedAt: Date.now()
        }
      });
    } catch {
      /* noop */
    }

    try {
      await this.persistence.stop();
    } catch {
      /* noop */
    }

    if (typeof this.utxoracle.stop === 'function') {
      try {
        await this.utxoracle.stop();
      } catch {
        /* best-effort */
      }
    }
    if (this._feedBitcoinStarted) {
      this._detachBitcoinStreamEvents();
      try {
        await this.bitcoin.stop();
      } catch {
        /* best-effort */
      }
      this._feedBitcoinStarted = false;
    }
    this._state.status = 'STOPPED';
    this.commit();
    return this;
  }

  async _latestData () {
    await this._sync();
    return this._buildReportPayload();
  }

  async _latestSpotPayload () {
    return {
      currency: this.currency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: ['BTC'],
      values: this.values,
      service: {
        id: this.id,
        status: this.status
      }
    };
  }

  async _utxoracleChainPayload () {
    const oracleOn =
      this.settings.sources.utxoracle?.enabled === true ||
      this.utxoracle?.settings?.enabled === true;
    if (!oracleOn) return null;
    try {
      return await this.utxoracle.chainTipStatsForReport();
    } catch (_) {
      return null;
    }
  }

  /**
   * Same JSON shape as {@link #_latestData} without running {@link #_sync}.
   * Callers that need a fresh network sync should run {@link #syncAllPrices} first.
   */
  async _buildReportPayload () {
    const persist = this.settings.persist || {};
    const exposeHistory = persist.exposePriceHistoryInReport !== false;

    const utxoracleChain = await this._utxoracleChainPayload();

    return {
      currency: this.currency,
      quoteCurrency: this.settings.quoteCurrency,
      symbols: ['BTC'],
      values: this.values,
      quoteProviders: this._quoteProvidersReport(),
      service: {
        id: this.id,
        status: this.status
      },
      ...(utxoracleChain ? { utxoracleChain } : {}),
      ...(exposeHistory
        ? {
            priceHistory: this._historyRows.slice()
          }
        : {}),
      persistedSnapshot: {
        historyRows:
          typeof this._historyRows?.length === 'number'
            ? this._historyRows.length
            : 0,
        envelopeSchema: FeedPriceStore.SNAPSHOT_SCHEMA_VERSION,
        snapshotDocumentKey: this.persistence.settings.snapshotKey ||
          'fabric.feed.snapshot.v2'
      }
    };
  }

  _installFeedReportWebSocket () {
    if (this._feedReportWss || !this.http?.http) return;
    const WebSocket = require('ws');
    const httpServer = this.http.http;
    const previous = httpServer.listeners('upgrade').slice();
    this._feedStreamUpgradePrevious = previous;
    httpServer.removeAllListeners('upgrade');
    httpServer.on('upgrade', this._onFeedStreamHttpUpgrade);

    this._feedReportWss = new WebSocket.Server({ noServer: true });
    this._feedReportWss.on('connection', (ws) => {
      this._feedStreamClients.add(ws);
      const detach = () => {
        this._feedStreamClients.delete(ws);
      };
      ws.on('close', detach);
      ws.on('error', detach);
      this._sendReportPayloadToSocket(ws).catch(() => {});
    });
  }

  _onFeedStreamHttpUpgrade (req, socket, head) {
    try {
      const host = req.headers.host || '127.0.0.1';
      const u = new URL(req.url, `http://${host}`);
      if (u.pathname === QUOTES_STREAM_PATH && this._feedReportWss) {
        this._feedReportWss.handleUpgrade(req, socket, head, (ws) => {
          this._feedReportWss.emit('connection', ws, req);
        });
        return;
      }
    } catch (_) {
      /* fall through to Fabric handler */
    }
    const prev = this._feedStreamUpgradePrevious;
    const ctx = this.http && this.http.http;
    if (prev && ctx) {
      for (let i = 0; i < prev.length; i++) {
        prev[i].call(ctx, req, socket, head);
      }
    }
  }

  async _sendReportPayloadToSocket (ws) {
    let payload;
    try {
      payload = await this._buildReportPayload();
    } catch (_) {
      return;
    }
    const raw = JSON.stringify(payload);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }

  async _broadcastFeedReportToStream () {
    if (!this._feedReportWss || this._feedStreamClients.size === 0) {
      return;
    }
    let payload;
    try {
      payload = await this._buildReportPayload();
    } catch (_) {
      return;
    }
    const raw = JSON.stringify(payload);
    for (const ws of this._feedStreamClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(raw);
        } catch (_) {
          /* dropped client */
        }
      }
    }
  }

  async _broadcastFeedReportToSse () {
    await this.sse.broadcast();
  }

  async _broadcastFeedReportToSubscribers () {
    await Promise.all([
      this._broadcastFeedReportToStream(),
      this._broadcastFeedReportToSse()
    ]);
  }

  /**
   * Push an auxiliary Fabric-shaped message to **`/quotes/stream`** clients (ZMQ-derived block events).
   * Distinct from full report snapshots so the UI can discriminate via {@code feedStream}.
   */
  _broadcastFeedStreamEvent (envelope) {
    if (!this._feedReportWss || this._feedStreamClients.size === 0) {
      return;
    }
    const WebSocket = require('ws');
    let raw;
    try {
      raw = JSON.stringify(envelope);
    } catch (_) {
      return;
    }
    for (const ws of this._feedStreamClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(raw);
        } catch (_) {
          /* dropped client */
        }
      }
    }
  }

  _attachBitcoinStreamEvents () {
    if (this._bitcoinStreamAttached || !this.bitcoin) return;
    this._bitcoinStreamAttached = true;
    this.bitcoin.on('block', this._onBitcoinBlockForStream);
    if (this.bitcoin.zmq) {
      this.bitcoin.zmq.on('message', this._onBitcoinZmqFabricMessage);
    }
  }

  _detachBitcoinStreamEvents () {
    if (!this._bitcoinStreamAttached || !this.bitcoin) return;
    this._bitcoinStreamAttached = false;
    this.bitcoin.removeListener('block', this._onBitcoinBlockForStream);
    if (this.bitcoin.zmq) {
      this.bitcoin.zmq.removeListener('message', this._onBitcoinZmqFabricMessage);
    }
  }

  /**
   * Fabric {@link Bitcoin} emits this after ZMQ `hashblock` (see {@link Bitcoin#_handleZMQMessage}).
   * @param {object} payload `{ tip, height, supply }` — {@code tip} is best block hash hex;
   *   {@code height} from UTXO set (chain depth for dashboards).
   */
  _onBitcoinBlockForStream (payload) {
    let data = payload;
    if (payload && typeof payload === 'object' && typeof payload.toObject === 'function') {
      try {
        data = payload.toObject();
      } catch (_) {
        /* use raw */
      }
    }
    this._broadcastFeedStreamEvent({
      feedStream: true,
      '@type': 'BitcoinBlockHash',
      '@data': data
    });
  }

  /**
   * ZMQ `rawblock` publishes as a Fabric {@link Message} (`BitcoinBlock`) before Core RPC enrichment.
   */
  _onBitcoinZmqFabricMessage (fabricMsg) {
    const t = fabricMsg && (fabricMsg.type || fabricMsg['@type']);
    if (t !== 'BitcoinBlock') return;
    let body;
    try {
      body = typeof fabricMsg.toObject === 'function' ? fabricMsg.toObject() : fabricMsg;
    } catch (_) {
      return;
    }
    this._broadcastFeedStreamEvent({
      feedStream: true,
      '@type': 'BitcoinBlock',
      '@data': body
    });
  }

  async _stopFeedReportStream () {
    this.sse.stop();
    if (this._commitBroadcastTimer) {
      clearTimeout(this._commitBroadcastTimer);
      this._commitBroadcastTimer = null;
    }
    if (this._feedReportWss) {
      for (const ws of this._feedStreamClients) {
        try {
          ws.terminate();
        } catch (_) {
          /* noop */
        }
      }
      this._feedStreamClients.clear();
      await new Promise((resolve) => {
        try {
          this._feedReportWss.close(resolve);
        } catch (_) {
          resolve();
        }
      });
      this._feedReportWss = null;
    }
    if (this._feedStreamUpgradePrevious && this.http?.http) {
      const srv = this.http.http;
      srv.removeAllListeners('upgrade');
      for (let i = 0; i < this._feedStreamUpgradePrevious.length; i++) {
        srv.on('upgrade', this._feedStreamUpgradePrevious[i]);
      }
      this._feedStreamUpgradePrevious = null;
    }
  }

  async _sync () {
    await Promise.all([
      this.syncAllPrices()
    ]);

    this.commit();

    return this;
  }
}

module.exports = Feed;
