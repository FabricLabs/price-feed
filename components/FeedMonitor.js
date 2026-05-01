'use strict';

/**
 * WebSocket path: Fabric routable `…/quotes` — binary {@code Message} frames with JSONPatch-style
 * `{ path, value }` after one-shot HTTP bootstrap (`_poll`). HTTP split endpoints run **only** when
 * {@link #webSocketEnabled} is false. Fabric Hub upgrade on `/` is unchanged.
 */

import { Component } from 'react';

import {
  Container,
  Divider,
  Header,
  Message,
  Segment
} from 'semantic-ui-react';

import Chart, { deltaForRange, resolveDeltaRangeOption } from './Chart';
import BitcoinTipCard from './feedMonitor/BitcoinTipCard';
import DeltaReadout from './feedMonitor/DeltaReadout';
import DeltaInline from './feedMonitor/DeltaInline';
import HeadlineSourceQuotes from './feedMonitor/HeadlineSourceQuotes';
import QuoteInspectModal from './feedMonitor/QuoteInspectModal';
import QuoteProvidersTable from './feedMonitor/QuoteProvidersTable';
import RecentQuotesList from './feedMonitor/RecentQuotesList';
import TimeSliceToolbar from './feedMonitor/TimeSliceToolbar';
import UtxOracleBlockNavigator from './feedMonitor/UtxOracleBlockNavigator';
import Feed from './Feed';
import {
  QUOTE_SYMBOL,
  MAX_QUOTE_HISTORY,
  MAX_QUOTE_ROWS,
  chartQuotesFromPriceHistory,
  filterQuotesBySourceVisibility,
  isSourceVisible,
  providerIdsForFilter,
  resolveBitcoinOracleEstimateSeriesUrl,
  resolveQuotesChainUrl,
  resolveQuotesHistoryUrl,
  resolveQuotesProvidersUrl,
  resolveQuotesSnapshotUrl,
  resolveQuotesSpotUrl,
  resolveQuotesFabricWsUrl,
  tryParseFabricJsonPatchMessageData
} from './feedMonitor/utils';
import { utxoSliceMinHeight } from './feedMonitor/UtxOracleBlockNavigator';

export default class FeedMonitor extends Component {
  static defaultProps = {
    currency: 'USD',
    /** Interval for HTTP-only periodic refresh ({@link #webSocketEnabled} false). */
    pollIntervalMs: 1050,
    /** Set false to use HTTP split endpoints + interval polling only (no WebSocket). */
    webSocketEnabled: true,
    /** Base URL of the running Feed HTTP service (no trailing slash). Same origin when empty. */
    feedApiBase: '',
    /**
     * Optional JSON from `scripts/backfill-history.js` (served next to `index.html`, e.g. `data/btc-usd-daily-ohlc.json`).
     * Empty string disables the fetch.
     */
    historicalOhlcUrl: 'data/btc-usd-daily-ohlc.json'
  };

  state = {
    quotes: [],
    spotsBySymbol: {},
    /** Cleared after the first report snapshot (WebSocket or HTTP). */
    reportLoading: true,
    pollError: null,
    /** From `/quotes/snapshot` quoteCurrency when present. */
    reportQuoteCurrency: undefined,
    /** Successful quote provider count for BTC (from aggregator). */
    sourceCountBySymbol: {},
    /** From GET /quotes/snapshot `quoteProviders` when present. */
    quoteProviders: [],
    inspectQuote: null,
    /** Selected window for overview price delta (`DELTA_RANGE_OPTIONS`). */
    deltaRangeKey: '1h',
    /** From GET /quotes/snapshot `utxoracleChain` when UTXOracle is on (tip, stats from bitcoind). */
    utxoracleChain: null,
    /**
     * Per-provider inclusion for headline / chart / history (`false` = excluded).
     * Omitted keys default to included.
     */
    sourceVisibility: {},
    /** Rows from GET /blocks?minHeight=&maxHeight=&maxPoints= (series, chart violet dots). */
    utxoEstimateSeries: [],
    utxoEstimateSeriesLoading: false,
    aggregationMode: 'depth-weighted'
  };

  constructor (props = {}) {
    super(props);

    /** @type {AbortController|null} */
    this._pollAbort = null;
    /** When true, a `/quotes/snapshot` round-trip is in progress. */
    this._pollInFlight = false;
    this._unmounted = false;
    this._reportWs = null;
    this._wsReconnectTimer = null;

    this._openInspectQuote = this._openInspectQuote.bind(this);
    this._closeInspectQuote = this._closeInspectQuote.bind(this);
    this._setDeltaRange = this._setDeltaRange.bind(this);
    this._setAggregationMode = this._setAggregationMode.bind(this);
    this._toggleSourceFilter = this._toggleSourceFilter.bind(this);
    this._sourceFilterSelectAll = this._sourceFilterSelectAll.bind(this);
    /** @type {AbortController|null} */
    this._utxoSeriesAbort = null;
  }

  _toggleSourceFilter (providerId) {
    if (this._unmounted || providerId == null) return;
    const id = String(providerId);
    this.setState((prev) => {
      const vis = { ...(prev.sourceVisibility || {}) };
      const on = vis[id] !== false;
      if (on) vis[id] = false;
      else delete vis[id];
      return { sourceVisibility: vis };
    });
  }

  _sourceFilterSelectAll () {
    if (this._unmounted) return;
    this.setState({ sourceVisibility: {} });
  }

  _sourceFilterSelectNone () {
    if (this._unmounted) return;
    const ids = providerIdsForFilter(this.state.quoteProviders, this.state.quotes);
    const vis = {};
    for (let i = 0; i < ids.length; i++) vis[ids[i]] = false;
    this.setState({ sourceVisibility: vis });
  }

  _setDeltaRange (key) {
    if (this._unmounted) return;
    this.setState({ deltaRangeKey: key });
  }

  _setAggregationMode (mode) {
    if (this._unmounted) return;
    if (mode !== 'depth-weighted' && mode !== 'weighted' && mode !== 'average') {
      return;
    }
    this.setState({ aggregationMode: mode });
  }

  componentDidMount () {
    this._unmounted = false;
    const useWs =
      this.props.webSocketEnabled !== false && typeof WebSocket !== 'undefined';
    if (useWs) {
      void (async () => {
        try {
          await this._poll();
        } catch {
          /* first paint may still open WS */
        }
        if (!this._unmounted) this._connectQuotesWebSocket();
      })();
    } else {
      void this._poll();
      this._restartHttpPollTimer();
    }
  }

  componentWillUnmount () {
    this._disconnectQuotesWebSocket(true);
    if (this._pollAbort) {
      this._pollAbort.abort();
      this._pollAbort = null;
    }
    if (this._utxoSeriesAbort) {
      this._utxoSeriesAbort.abort();
      this._utxoSeriesAbort = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._unmounted = true;
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevProps.feedApiBase !== this.props.feedApiBase) {
      const useWs =
        this.props.webSocketEnabled !== false && typeof WebSocket !== 'undefined';
      if (useWs) {
        this._disconnectQuotesWebSocket(true);
        if (!this._unmounted) {
          this.setState({ reportLoading: true, pollError: null });
        }
        void (async () => {
          try {
            await this._poll();
          } catch {
            /* continue to WS */
          }
          if (!this._unmounted) this._connectQuotesWebSocket();
        })();
      } else {
        void this._poll();
        this._restartHttpPollTimer();
      }
    }
    const tip =
      this.state.utxoracleChain &&
      Number.isFinite(Number(this.state.utxoracleChain.tip))
        ? Math.floor(Number(this.state.utxoracleChain.tip))
        : null;
    const prevTip =
      prevState.utxoracleChain &&
      Number.isFinite(Number(prevState.utxoracleChain.tip))
        ? Math.floor(Number(prevState.utxoracleChain.tip))
        : null;
    if (
      prevProps.feedApiBase !== this.props.feedApiBase ||
      prevState.deltaRangeKey !== this.state.deltaRangeKey ||
      tip !== prevTip ||
      prevState.quoteProviders !== this.state.quoteProviders
    ) {
      this._loadUtxoEstimateSeries();
    }
  }

  _loadUtxoEstimateSeries () {
    if (this._unmounted) return;
    if (this._utxoSeriesAbort) {
      this._utxoSeriesAbort.abort();
      this._utxoSeriesAbort = null;
    }
    const providers = Array.isArray(this.state.quoteProviders)
      ? this.state.quoteProviders
      : [];
    const utxoOn = providers.some(
      (p) => String(p.id || '') === 'utxoracle' && p.enabled === true
    );
    if (!utxoOn) {
      if (
        this.state.utxoEstimateSeries.length > 0 ||
        this.state.utxoEstimateSeriesLoading
      ) {
        this.setState({
          utxoEstimateSeries: [],
          utxoEstimateSeriesLoading: false
        });
      }
      return;
    }
    const tip =
      this.state.utxoracleChain &&
      Number.isFinite(Number(this.state.utxoracleChain.tip))
        ? Math.floor(Number(this.state.utxoracleChain.tip))
        : null;
    if (tip == null) {
      if (this.state.utxoEstimateSeriesLoading) {
        this.setState({ utxoEstimateSeriesLoading: false });
      }
      return;
    }
    const rangeOpt = resolveDeltaRangeOption(this.state.deltaRangeKey);
    const sliceMin = utxoSliceMinHeight(tip, rangeOpt.ms);
    const span = tip - sliceMin + 1;
    const maxPoints = Math.max(1, span);
    const baseUrl = resolveBitcoinOracleEstimateSeriesUrl(this.props.feedApiBase);
    let url;
    try {
      url = new URL(baseUrl);
      url.searchParams.set('minHeight', String(sliceMin));
      url.searchParams.set('maxHeight', String(tip));
      url.searchParams.set('maxPoints', String(maxPoints));
    } catch {
      return;
    }

    const ac = new AbortController();
    this._utxoSeriesAbort = ac;
    this.setState({ utxoEstimateSeriesLoading: true });

    fetch(String(url), {
      signal: ac.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer-when-downgrade'
    })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          const err =
            j && typeof j.error === 'string'
              ? j.error
              : `${res.status} ${res.statusText}`;
          throw new Error(err);
        }
        return res.json();
      })
      .then((body) => {
        if (this._unmounted || this._utxoSeriesAbort !== ac) return;
        const pts =
          body &&
          typeof body === 'object' &&
          Array.isArray(body.points)
            ? body.points
            : [];
        this.setState({
          utxoEstimateSeries: pts,
          utxoEstimateSeriesLoading: false
        });
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || this._unmounted) return;
        if (this._utxoSeriesAbort !== ac) return;
        this.setState({
          utxoEstimateSeries: [],
          utxoEstimateSeriesLoading: false
        });
      })
      .finally(() => {
        if (this._utxoSeriesAbort === ac) {
          this._utxoSeriesAbort = null;
        }
      });
  }

  /**
   * Interval polling for {@link #webSocketEnabled} false only.
   */
  _restartHttpPollTimer () {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._unmounted) return;
    if (
      this.props.webSocketEnabled !== false &&
      typeof WebSocket !== 'undefined'
    ) {
      return;
    }
    const ms = Math.max(200, Number(this.props.pollIntervalMs) || 1050);
    this._pollTimer = setInterval(() => {
      void this._poll();
    }, ms);
  }

  _disconnectQuotesWebSocket (clearReconnect) {
    if (clearReconnect) {
      clearTimeout(this._wsReconnectTimer);
      this._wsReconnectTimer = null;
    }
    if (this._reportWs) {
      const ws = this._reportWs;
      this._reportWs = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }

  _connectQuotesWebSocket () {
    if (
      this._unmounted ||
      this.props.webSocketEnabled === false ||
      typeof WebSocket === 'undefined'
    ) {
      return;
    }
    this._disconnectQuotesWebSocket(false);
    let ws;
    try {
      ws = new WebSocket(resolveQuotesFabricWsUrl(this.props.feedApiBase));
    } catch {
      return;
    }
    this._reportWs = ws;
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (ev) => {
      if (this._unmounted || this._reportWs !== ws) return;
      const data = ev.data;
      let ab = null;
      if (data instanceof ArrayBuffer) ab = data;
      else if (data && data.buffer instanceof ArrayBuffer) {
        const u = new Uint8Array(
          data.buffer,
          data.byteOffset | 0,
          data.byteLength | 0
        );
        ab = u.slice().buffer;
      }
      if (!ab) return;
      const patch = tryParseFabricJsonPatchMessageData(ab);
      if (!patch) return;
      this._applyFabricQuotesPatch(patch.path, patch.value);
    };

    ws.onclose = () => {
      if (this._reportWs !== ws) return;
      this._disconnectQuotesWebSocket(false);
      if (!this._unmounted && this.props.webSocketEnabled !== false) {
        clearTimeout(this._wsReconnectTimer);
        this._wsReconnectTimer = setTimeout(
          () => this._connectQuotesWebSocket(),
          2500
        );
      }
    };

    ws.onerror = () => {
      /* onclose runs next */
    };
  }

  /**
   * Apply spot / aggregate counts from a `/quotes/values` patch without duplicating chart rows
   * (history uses {@link #_applyFabricQuotesPatch} for `/quotes/priceHistoryAppend`).
   * @param {Record<string, unknown>} values
   */
  _applyFabricValuesOnly (values) {
    if (this._unmounted || !values || typeof values !== 'object') return;
    const quoteSym = QUOTE_SYMBOL;
    const btcRow = values[quoteSym];
    const price =
      btcRow && btcRow.price != null ? Number(btcRow.price) : NaN;
    const spotsBySymbol = {};
    const sourceCountBySymbol = {};
    if (Number.isFinite(price)) {
      spotsBySymbol[quoteSym] = price;
    }
    const sc =
      btcRow && btcRow.sourceCount != null
        ? Number(btcRow.sourceCount)
        : undefined;
    if (Number.isFinite(sc)) {
      sourceCountBySymbol[quoteSym] = sc;
    }
    this.setState((prev) => ({
      spotsBySymbol: { ...prev.spotsBySymbol, ...spotsBySymbol },
      sourceCountBySymbol: {
        ...prev.sourceCountBySymbol,
        ...sourceCountBySymbol
      },
      reportLoading: false
    }));
  }

  /**
   * @param {string} path Normalized Fabric path (e.g. `/quotes/values`).
   * @param {unknown} value
   */
  _applyFabricQuotesPatch (path, value) {
    if (this._unmounted) return;
    const p = String(path || '').replace(/\/+$/, '') || '';

    if (p === '/quotes/values' || p.startsWith('/quotes/values/')) {
      this._applyFabricValuesOnly(
        /** @type {Record<string, unknown>} */ (value)
      );
      return;
    }
    if (p === '/quotes/quoteProviders') {
      this._applyReportBody(
        { quoteProviders: value },
        { partial: true }
      );
      return;
    }
    if (p === '/quotes/quoteCurrency') {
      this._applyReportBody(
        { quoteCurrency: value },
        { partial: true }
      );
      return;
    }
    if (p === '/quotes/utxoracleChain') {
      this._applyReportBody(
        { utxoracleChain: value },
        { partial: true }
      );
      return;
    }
    if (p === '/quotes/priceHistoryAppend') {
      const rows =
        value &&
        typeof value === 'object' &&
        Array.isArray(
          /** @type {{ rows?: unknown }} */ (value).rows
        )
          ? /** @type {{ rows: unknown[] }} */ (value).rows
          : [];
      if (!rows.length) return;
      const fiat =
        this.state.reportQuoteCurrency || this.props.currency;
      const appended = chartQuotesFromPriceHistory(
        rows,
        QUOTE_SYMBOL,
        fiat
      );
      this.setState((prev) => {
        let next = prev.quotes.concat(appended);
        if (next.length > MAX_QUOTE_HISTORY) {
          next = next.slice(-MAX_QUOTE_HISTORY);
        }
        return { quotes: next, reportLoading: false };
      });
      return;
    }
    if (p === '/quotes/feedStream') {
      if (
        value &&
        typeof value === 'object' &&
        /** @type {{ feedStream?: boolean }} */ (value).feedStream === true
      ) {
        this._handleFeedStreamSideMessage(
          /** @type {object} */ (value)
        );
      }
      return;
    }
  }

  /**
   * ZMQ / RPC tip events delivered as `/quotes/feedStream` patch values.
   * @param {object} msg
   */
  _handleFeedStreamSideMessage (msg) {
    if (this._unmounted || !msg || typeof msg !== 'object') return;
    const t = msg['@type'];
    if (t === 'BitcoinBlockHash' && msg['@data'] && typeof msg['@data'] === 'object') {
      const d = msg['@data'];
      const h = typeof d.height === 'number' ? d.height : Number(d.height);
      if (!Number.isFinite(h)) return;
      this.setState((prev) => ({
        utxoracleChain: {
          ...(prev.utxoracleChain && typeof prev.utxoracleChain === 'object'
            ? prev.utxoracleChain
            : {}),
          tip: Math.floor(h)
        }
      }));
    }
  }

  _openInspectQuote (quote) {
    if (this._unmounted || !quote?.sources?.length) return;
    this.setState({ inspectQuote: quote });
  }

  _closeInspectQuote () {
    if (this._unmounted) return;
    this.setState({ inspectQuote: null });
  }

  /**
   * @param {object} body Parsed `/quotes/snapshot` or WebSocket JSON
   * @param {{ partial?: boolean, transportErrors?: string|null }} [opts]
   */
  _applyReportBody (body, opts = {}) {
    if (this._unmounted || !body || typeof body !== 'object') return;

    const partial = opts.partial === true;
    const transportErrors =
      opts.transportErrors != null && String(opts.transportErrors).trim() !== ''
        ? String(opts.transportErrors).trim()
        : null;

    const quoteSym = QUOTE_SYMBOL;

    const values =
      body.values && typeof body.values === 'object' ? body.values : {};
    const spotsBySymbol = {};
    const sourceCountBySymbol = {};

    const failures = [];

    const btcRow = values[quoteSym];
    const price =
      btcRow && btcRow.price != null ? Number(btcRow.price) : NaN;
    if (Object.prototype.hasOwnProperty.call(body, 'values')) {
      if (Number.isFinite(price)) {
        spotsBySymbol[quoteSym] = price;
        const sc =
          btcRow && btcRow.sourceCount != null ? Number(btcRow.sourceCount) : undefined;
        if (Number.isFinite(sc)) {
          sourceCountBySymbol[quoteSym] = sc;
        }
      } else {
        failures.push(`${quoteSym}: no price`);
      }
    }

    const fiatEarly =
      body.quoteCurrency != null && String(body.quoteCurrency).trim() !== ''
        ? String(body.quoteCurrency).trim().toUpperCase()
        : this.props.currency;

    const priceHist = body.priceHistory;
    const hasServerHistory =
      Array.isArray(priceHist) && priceHist.length > 0;

    const leadPrice = price;

    /** @param {typeof this.state} prev */
    const buildQuotesPatch = (prev) => {
      let nextQuotes = prev.quotes;
      if (hasServerHistory && quoteSym) {
        nextQuotes = chartQuotesFromPriceHistory(
          priceHist,
          quoteSym,
          fiatEarly
        );
        if (nextQuotes.length > MAX_QUOTE_HISTORY) {
          nextQuotes = nextQuotes.slice(-MAX_QUOTE_HISTORY);
        }
      } else if (
        Object.prototype.hasOwnProperty.call(body, 'values') &&
        Number.isFinite(leadPrice) &&
        quoteSym
      ) {
        const scAgg =
          btcRow &&
          typeof btcRow.sourceCount === 'number'
            ? btcRow.sourceCount
            : undefined;

        /** @type {unknown[] | undefined} */
        const contrib =
          Array.isArray(btcRow.sources)
            ? [].concat(btcRow.sources)
            : undefined;

        const row = {
          created: new Date().toISOString(),
          rate: leadPrice,
          currency: body.quoteCurrency || this.props.currency,
          symbol: quoteSym,
          source: 'Feed',
          sourceCount: scAgg,
          ...(contrib && contrib.length
            ? { sources: contrib }
            : {})
        };

        nextQuotes = prev.quotes.concat(row);
        if (nextQuotes.length > MAX_QUOTE_HISTORY) {
          nextQuotes = nextQuotes.slice(-MAX_QUOTE_HISTORY);
        }
      }
      return nextQuotes;
    };

    const localErr =
      Object.prototype.hasOwnProperty.call(body, 'values') && failures.length
        ? failures.join(' · ')
        : null;
    const pollErr =
      [transportErrors, localErr].filter(Boolean).join(' · ') || null;

    if (!this._unmounted) {
      if (!partial) {
        let nextQuotes = this.state.quotes;
        if (hasServerHistory && quoteSym) {
          nextQuotes = chartQuotesFromPriceHistory(
            priceHist,
            quoteSym,
            fiatEarly
          );
          if (nextQuotes.length > MAX_QUOTE_HISTORY) {
            nextQuotes = nextQuotes.slice(-MAX_QUOTE_HISTORY);
          }
        } else if (Number.isFinite(leadPrice) && quoteSym) {
          const scAgg =
            btcRow &&
            typeof btcRow.sourceCount === 'number'
              ? btcRow.sourceCount
              : undefined;

          /** @type {unknown[] | undefined} */
          const contrib =
            Array.isArray(btcRow.sources)
              ? [].concat(btcRow.sources)
              : undefined;

          const row = {
            created: new Date().toISOString(),
            rate: leadPrice,
            currency: body.quoteCurrency || this.props.currency,
            symbol: quoteSym,
            source: 'Feed',
            sourceCount: scAgg,
            ...(contrib && contrib.length
              ? { sources: contrib }
              : {})
          };

          nextQuotes = this.state.quotes.concat(row);
          if (nextQuotes.length > MAX_QUOTE_HISTORY) {
            nextQuotes = nextQuotes.slice(-MAX_QUOTE_HISTORY);
          }
        }

        const patch = {
          spotsBySymbol,
          sourceCountBySymbol,
          quotes: nextQuotes,
          pollError: pollErr
        };
        if (body.quoteCurrency != null && String(body.quoteCurrency).trim() !== '') {
          patch.reportQuoteCurrency = String(body.quoteCurrency).trim().toUpperCase();
        }

        if (Array.isArray(body.quoteProviders)) {
          patch.quoteProviders = [].concat(body.quoteProviders);
        }

        const ucx = body.utxoracleChain;
        if (
          ucx &&
          typeof ucx === 'object' &&
          Number.isFinite(Number(ucx.tip))
        ) {
          const tip = Math.floor(Number(ucx.tip));
          patch.utxoracleChain = {
            tip,
            tipAsOfMs: Math.round(Number(ucx.tipAsOfMs)),
            difficulty:
              ucx.difficulty != null && Number.isFinite(Number(ucx.difficulty))
                ? Number(ucx.difficulty)
                : null,
            chain: typeof ucx.chain === 'string' ? ucx.chain : '',
            headers:
              ucx.headers != null && Number.isFinite(Number(ucx.headers))
                ? Math.floor(Number(ucx.headers))
                : tip,
            verificationProgress:
              ucx.verificationProgress != null &&
              Number.isFinite(Number(ucx.verificationProgress))
                ? Number(ucx.verificationProgress)
                : null,
            initialBlockDownload: ucx.initialBlockDownload === true,
            pruned: ucx.pruned === true,
            circulatingSupplyBtc:
              ucx.circulatingSupplyBtc != null &&
              Number.isFinite(Number(ucx.circulatingSupplyBtc))
                ? Number(ucx.circulatingSupplyBtc)
                : null,
            tipBlockOutputBtc:
              ucx.tipBlockOutputBtc != null &&
              Number.isFinite(Number(ucx.tipBlockOutputBtc))
                ? Number(ucx.tipBlockOutputBtc)
                : null
          };
        } else {
          patch.utxoracleChain = null;
        }

        this.setState({
          ...patch,
          reportLoading: false
        });
        return;
      }

      this.setState((prev) => {
        const patch = {
          quotes: prev.quotes,
          pollError: pollErr,
          reportLoading: false
        };

        if (Object.prototype.hasOwnProperty.call(body, 'values')) {
          patch.spotsBySymbol = spotsBySymbol;
          patch.sourceCountBySymbol = sourceCountBySymbol;
        } else {
          patch.spotsBySymbol = prev.spotsBySymbol;
          patch.sourceCountBySymbol = prev.sourceCountBySymbol;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'priceHistory')) {
          patch.quotes = buildQuotesPatch(prev);
        } else if (Object.prototype.hasOwnProperty.call(body, 'values')) {
          patch.quotes = buildQuotesPatch(prev);
        } else {
          patch.quotes = prev.quotes;
        }

        if (body.quoteCurrency != null && String(body.quoteCurrency).trim() !== '') {
          patch.reportQuoteCurrency = String(body.quoteCurrency).trim().toUpperCase();
        } else {
          patch.reportQuoteCurrency = prev.reportQuoteCurrency;
        }

        if (Array.isArray(body.quoteProviders)) {
          patch.quoteProviders = [].concat(body.quoteProviders);
        } else {
          patch.quoteProviders = prev.quoteProviders;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'utxoracleChain')) {
          const ucx = body.utxoracleChain;
          if (
            ucx &&
            typeof ucx === 'object' &&
            Number.isFinite(Number(ucx.tip))
          ) {
            const tip = Math.floor(Number(ucx.tip));
            patch.utxoracleChain = {
              tip,
              tipAsOfMs: Math.round(Number(ucx.tipAsOfMs)),
              difficulty:
                ucx.difficulty != null && Number.isFinite(Number(ucx.difficulty))
                  ? Number(ucx.difficulty)
                  : null,
              chain: typeof ucx.chain === 'string' ? ucx.chain : '',
              headers:
                ucx.headers != null && Number.isFinite(Number(ucx.headers))
                  ? Math.floor(Number(ucx.headers))
                  : tip,
              verificationProgress:
                ucx.verificationProgress != null &&
                Number.isFinite(Number(ucx.verificationProgress))
                  ? Number(ucx.verificationProgress)
                  : null,
              initialBlockDownload: ucx.initialBlockDownload === true,
              pruned: ucx.pruned === true,
              circulatingSupplyBtc:
                ucx.circulatingSupplyBtc != null &&
                Number.isFinite(Number(ucx.circulatingSupplyBtc))
                  ? Number(ucx.circulatingSupplyBtc)
                  : null,
              tipBlockOutputBtc:
                ucx.tipBlockOutputBtc != null &&
                Number.isFinite(Number(ucx.tipBlockOutputBtc))
                  ? Number(ucx.tipBlockOutputBtc)
                  : null
            };
          } else {
            patch.utxoracleChain = null;
          }
        } else {
          patch.utxoracleChain = prev.utxoracleChain;
        }

        return patch;
      });
    }
  }

  /**
   * HTTP refresh: split {@code GET} endpoints plus optional snapshot fallback.
   * When {@link #webSocketEnabled} is true, this runs once at mount (bootstrap) then incremental
   * updates use Fabric `…/quotes` patches ({@link #_connectQuotesWebSocket}).
   */
  async _poll () {
    if (this._pollInFlight) return;
    this._pollInFlight = true;

    const ac = new AbortController();
    this._pollAbort = ac;

    try {
      /**
       * Split endpoints so one timeout (524) or bad request (400) does not abort the whole poll.
       * @param {string} label
       * @param {string} url
       */
      const fetchSplit = async (label, url) => {
        try {
          const res = await fetch(url, {
            signal: ac.signal,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            referrerPolicy: 'no-referrer-when-downgrade'
          });
          if (!res.ok) {
            return {
              label,
              ok: false,
              status: res.status,
              body: null
            };
          }
          const j = await res.json();
          return {
            label,
            ok: true,
            status: res.status,
            body: j && typeof j === 'object' ? j : {}
          };
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          return {
            label,
            ok: false,
            status: 0,
            body: null,
            err: e?.message || String(e)
          };
        }
      };

      const spotUrl = resolveQuotesSpotUrl(this.props.feedApiBase);
      const providersUrl = resolveQuotesProvidersUrl(this.props.feedApiBase);
      const historyUrl = `${resolveQuotesHistoryUrl(this.props.feedApiBase)}?limit=${MAX_QUOTE_HISTORY}`;
      const chainUrl = resolveQuotesChainUrl(this.props.feedApiBase);

      const results = await Promise.all([
        fetchSplit('spot', spotUrl),
        fetchSplit('providers', providersUrl),
        fetchSplit('history', historyUrl),
        fetchSplit('chain', chainUrl)
      ]);

      const transportErrors = [];
      /** @type {Record<string, unknown>} */
      let body = {};

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.ok && r.body) {
          body = { ...body, ...r.body };
        } else {
          const bit =
            r.status != null && r.status > 0
              ? `${r.label} ${r.status}`
              : `${r.label}: ${r.err || 'failed'}`;
          transportErrors.push(bit);
        }
      }

      const sym = QUOTE_SYMBOL;
      const hasSpotPrice =
        body.values &&
        typeof body.values === 'object' &&
        body.values[sym] &&
        Number.isFinite(Number(/** @type {{ price?: unknown }} */ (body.values[sym]).price));
      const hasHistory =
        Array.isArray(body.priceHistory) && body.priceHistory.length > 0;

      if (!hasSpotPrice && !hasHistory) {
        try {
          const res = await fetch(resolveQuotesSnapshotUrl(this.props.feedApiBase), {
            signal: ac.signal,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            referrerPolicy: 'no-referrer-when-downgrade'
          });
          if (res.ok) {
            const snap = await res.json();
            if (this._unmounted) return;
            this._applyReportBody(
              snap && typeof snap === 'object' ? snap : {},
              {
                partial: false,
                transportErrors:
                  transportErrors.length > 0 ? transportErrors.join(' · ') : null
              }
            );
            return;
          }
          transportErrors.push(`snapshot ${res.status}`);
        } catch (fallbackErr) {
          if (fallbackErr?.name === 'AbortError') return;
          transportErrors.push(
            `snapshot: ${fallbackErr?.message || String(fallbackErr)}`
          );
        }
      }

      if (this._unmounted) return;
      this._applyReportBody(body, {
        partial: true,
        transportErrors:
          transportErrors.length > 0 ? transportErrors.join(' · ') : null
      });
    } finally {
      this._pollInFlight = false;
      if (this._pollAbort === ac) {
        this._pollAbort = null;
      }
      if (!this._unmounted) {
        this.setState((prev) =>
          prev.reportLoading ? { reportLoading: false } : null
        );
      }
    }
  }

  render () {
    const sourceVisibility = this.state.sourceVisibility || {};
    const quotesFiltered = filterQuotesBySourceVisibility(
      this.state.quotes,
      sourceVisibility,
      this.state.aggregationMode
    );

    const quotesNewestFirst = [].concat(quotesFiltered).sort((a, b) =>
      Date.parse(b.created) - Date.parse(a.created)
    );

    const quoteView = quotesNewestFirst.slice(0, MAX_QUOTE_ROWS);

    const serverLead = this.state.spotsBySymbol[QUOTE_SYMBOL];
    const serverSrcCount = this.state.sourceCountBySymbol[QUOTE_SYMBOL];

    let leadUsd = serverLead;
    /** @type {number|undefined} */
    let btcSourceCount = serverSrcCount;
    if (this.state.quotes.length > 0) {
      if (quotesNewestFirst.length > 0) {
        const newest = quotesNewestFirst[0];
        const r = Number(newest.rate);
        if (Number.isFinite(r) && r > 0) {
          leadUsd = r;
          const sc = newest.sourceCount;
          btcSourceCount =
            typeof sc === 'number' && Number.isFinite(sc)
              ? sc
              : Array.isArray(newest.sources)
                ? newest.sources.length
                : undefined;
        } else {
          leadUsd = undefined;
          btcSourceCount = 0;
        }
      } else {
        leadUsd = undefined;
        btcSourceCount = 0;
      }
    }

    const fiat =
      this.state.reportQuoteCurrency !== undefined && this.state.reportQuoteCurrency !== null
        ? this.state.reportQuoteCurrency
        : this.props.currency;

    const inspectQuote = this.state.inspectQuote;
    const quoteProviders = Array.isArray(this.state.quoteProviders)
      ? this.state.quoteProviders
      : [];
    const utxoOracleEnabled = quoteProviders.some(
      (p) => String(p.id || '') === 'utxoracle' && p.enabled === true
    );
    const providerIds = providerIdsForFilter(quoteProviders, this.state.quotes);
    const labelById = new Map(
      quoteProviders.map((p) => [
        String(p.id || ''),
        String(p.label || p.id || '')
      ])
    );

    const tlsByProvider = new Map();
    for (let ti = 0; ti < quoteProviders.length; ti++) {
      const p = quoteProviders[ti];
      const pid = p && p.id != null ? String(p.id) : '';
      if (pid && p.lastTls && typeof p.lastTls === 'object') {
        tlsByProvider.set(pid, p.lastTls);
      }
    }

    const rangeOpt = resolveDeltaRangeOption(this.state.deltaRangeKey);
    const delta = deltaForRange(
      typeof leadUsd === 'number' ? leadUsd : NaN,
      quotesFiltered,
      rangeOpt
    );

    const headlineQuote = quotesNewestFirst[0];
    const wsPrimary =
      this.props.webSocketEnabled !== false &&
      typeof WebSocket !== 'undefined';
    const utxoSrc =
      headlineQuote &&
      Array.isArray(headlineQuote.sources)
        ? headlineQuote.sources.find(
            (s) =>
              s &&
              String(s.provider || '') === 'utxoracle' &&
              Number.isFinite(Number(s.price))
          )
        : null;
    const utxoSpotForCard =
      utxoSrc && Number.isFinite(Number(utxoSrc.price))
        ? {
            price: Number(utxoSrc.price),
            fiat,
            excludedFromSpot:
              /** @type {{ excludedFromSpot?: boolean }} */ (utxoSrc)
                .excludedFromSpot === true
          }
        : null;
    const showHeadlineSourceColumn =
      headlineQuote &&
      Array.isArray(headlineQuote.sources) &&
      headlineQuote.sources.some(
        (s) =>
          isSourceVisible(
            /** @type {{ provider?: string }} */ (s)?.provider,
            sourceVisibility
          ) && Number.isFinite(Number(s?.price))
      );

    return (
      <Container text style={{ paddingTop: '1rem', paddingBottom: '2rem' }}>
        <Segment raised padded clearing>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap'
            }}
          >
            <Header style={{ marginBottom: 0 }}>
              <code>fiat.fabric.pub</code>
            </Header>
            {showHeadlineSourceColumn ? (
              <div style={{ flex: '1 1 360px' }}>
                <HeadlineSourceQuotes
                  quote={headlineQuote}
                  sourceVisibility={sourceVisibility}
                  labelById={labelById}
                  fiat={fiat}
                  tlsByProvider={tlsByProvider}
                  onOpenInspect={this._openInspectQuote}
                  aggregationMode={this.state.aggregationMode}
                  compact
                />
              </div>
            ) : null}
          </div>
          {this.state.reportLoading && !this.state.pollError ? (
            <Message info size="small">
              {wsPrimary ? (
                <>
                  Connecting to{' '}
                  <code>{resolveQuotesFabricWsUrl(this.props.feedApiBase)}</code>…
                </>
              ) : (
                <>
                  Fetching spot/providers/history from{' '}
                  <code>{resolveQuotesSpotUrl(this.props.feedApiBase)}</code>…
                </>
              )}
            </Message>
          ) : null}
          {this.state.pollError ? (
            <Message warning size="small">
              Feed data incomplete: {this.state.pollError}
            </Message>
          ) : null}
          <Feed
            spotUsd={leadUsd}
            spotCurrency={fiat}
            label={
              typeof btcSourceCount === 'number'
                ? `BTC → ${fiat} · ${this.state.aggregationMode} (${btcSourceCount} source${btcSourceCount === 1 ? '' : 's'})`
                : `BTC → ${fiat}`
            }
            trailing={
              typeof leadUsd === 'number' && Number.isFinite(leadUsd) ? (
                <DeltaInline delta={delta} fiat={fiat} />
              ) : null
            }
            aside={
              null
            }
          />

          {utxoOracleEnabled ? (
            <BitcoinTipCard
              chain={this.state.utxoracleChain}
              utxoSpot={utxoSpotForCard}
              headlineSpotUsd={
                typeof leadUsd === 'number' && Number.isFinite(leadUsd)
                  ? leadUsd
                  : null
              }
              fiat={fiat}
            />
          ) : null}

          {utxoOracleEnabled ? (
            <div style={{ width: '100%', marginTop: '1rem' }}>
              <UtxOracleBlockNavigator
                feedApiBase={this.props.feedApiBase}
                enabled={utxoOracleEnabled}
                rangeOpt={rangeOpt}
                utxoracleChain={this.state.utxoracleChain}
              />
            </div>
          ) : null}

          <div style={{ width: '100%', marginTop: '1rem' }}>
            <TimeSliceToolbar
              deltaRangeKey={this.state.deltaRangeKey}
              onSetRange={this._setDeltaRange}
              rangeOpt={rangeOpt}
              aggregationMode={this.state.aggregationMode}
              onSetAggregationMode={this._setAggregationMode}
              sourceFilter={
                providerIds.length
                  ? {
                      providerIds,
                      labelById,
                      sourceVisibility,
                      onToggle: this._toggleSourceFilter,
                      onSelectAll: this._sourceFilterSelectAll,
                      onSelectNone: this._sourceFilterSelectNone
                    }
                  : null
              }
            />
            <DeltaReadout
              rangeOpt={rangeOpt}
              delta={delta}
              leadUsd={leadUsd}
            />
          </div>

          <Chart
            quotes={quotesFiltered}
            deltaRangeKey={this.state.deltaRangeKey}
            reportQuoteCurrency={this.state.reportQuoteCurrency}
            currency={this.props.currency}
            pollError={this.state.pollError}
            historicalOhlcUrl={this.props.historicalOhlcUrl}
            utxoEstimateSeries={
              utxoOracleEnabled ? this.state.utxoEstimateSeries : null
            }
            utxoEstimateSeriesLoading={
              utxoOracleEnabled && this.state.utxoEstimateSeriesLoading
            }
          />

          <Header dividing>Sources</Header>
          <QuoteProvidersTable providers={quoteProviders} />

          <Divider section />

          <RecentQuotesList
            quoteView={quoteView}
            totalQuotes={quotesNewestFirst.length}
            onOpenInspect={this._openInspectQuote}
          />

          <QuoteInspectModal
            open={inspectQuote != null}
            quote={inspectQuote}
            tlsByProvider={tlsByProvider}
            onClose={this._closeInspectQuote}
          />
        </Segment>
        <Segment>
          <p><code><a href="https://github.com/FabricLabs/price-feed.git">git://</a></code></p>
        </Segment>
      </Container>
    );
  }
}
