'use strict';

/**
 * Primary path: plain JSON WebSocket `…/quotes/stream` (initial snapshot + server push).
 * Fallback: `GET …/quotes/snapshot` only when WebSockets are disabled, unavailable, stalled,
 * or after an unexpected disconnect (one-shot). Fabric Hub upgrade on `/` is unchanged.
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
  resolveQuotesStreamUrl
} from './feedMonitor/utils';
import { utxoSliceMinHeight } from './feedMonitor/UtxOracleBlockNavigator';

export default class FeedMonitor extends Component {
  static defaultProps = {
    currency: 'USD',
    /** Interval for HTTP-only periodic refresh ({@link #webSocketEnabled} false). */
    pollIntervalMs: 1050,
    /**
     * If the stream does not deliver a report snapshot within this time (milliseconds),
     * perform a one-shot {@code GET /quotes/snapshot}.
     */
    webSocketStallFallbackMs: 8000,
    /** Set false to use HTTP polling only ({@link #pollIntervalMs}). */
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
    /** Cleared after the first poll attempt finishes (success or handled error). */
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
    utxoEstimateSeriesLoading: false
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
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._wsStallFallbackTimer = null;

    this._openInspectQuote = this._openInspectQuote.bind(this);
    this._closeInspectQuote = this._closeInspectQuote.bind(this);
    this._setDeltaRange = this._setDeltaRange.bind(this);
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

  componentDidMount () {
    this._unmounted = false;
    const useWs =
      this.props.webSocketEnabled !== false && typeof WebSocket !== 'undefined';
    if (useWs) {
      this._connectReportStream();
    } else {
      void this._poll();
      this._restartHttpPollTimer();
    }
  }

  componentWillUnmount () {
    this._disconnectReportStream(true);
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
    if (this._wsStallFallbackTimer) {
      clearTimeout(this._wsStallFallbackTimer);
      this._wsStallFallbackTimer = null;
    }
    this._unmounted = true;
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevProps.feedApiBase !== this.props.feedApiBase) {
      const useWs =
        this.props.webSocketEnabled !== false && typeof WebSocket !== 'undefined';
      if (useWs) {
        this._disconnectReportStream(true);
        this._clearWsStallFallback();
        if (!this._unmounted) {
          this.setState({ reportLoading: true, pollError: null });
        }
        this._connectReportStream();
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

  _clearWsStallFallback () {
    if (this._wsStallFallbackTimer) {
      clearTimeout(this._wsStallFallbackTimer);
      this._wsStallFallbackTimer = null;
    }
  }

  _scheduleWsStallFallback () {
    this._clearWsStallFallback();
    if (
      this._unmounted ||
      this.props.webSocketEnabled === false ||
      typeof WebSocket === 'undefined'
    ) {
      return;
    }
    const raw = this.props.webSocketStallFallbackMs;
    const ms =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 8000;
    this._wsStallFallbackTimer = setTimeout(() => {
      this._wsStallFallbackTimer = null;
      if (this._unmounted) return;
      if (!this.state.reportLoading) return;
      void this._poll();
    }, ms);
  }

  _disconnectReportStream (clearReconnect) {
    if (clearReconnect) {
      clearTimeout(this._wsReconnectTimer);
      this._wsReconnectTimer = null;
    }
    this._clearWsStallFallback();
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

  _connectReportStream () {
    if (
      this._unmounted ||
      this.props.webSocketEnabled === false ||
      typeof WebSocket === 'undefined'
    ) {
      return;
    }
    this._disconnectReportStream(false);
    let ws;
    try {
      ws = new WebSocket(resolveQuotesStreamUrl(this.props.feedApiBase));
    } catch {
      return;
    }
    this._reportWs = ws;

    ws.onmessage = (ev) => {
      if (this._unmounted || this._reportWs !== ws) return;
      let body;
      try {
        body = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!body || typeof body !== 'object') return;
      if (body.feedStream === true) {
        this._handleFeedStreamSideMessage(body);
        return;
      }
      this._applyReportBody(body);
    };

    ws.onclose = () => {
      if (this._reportWs !== ws) return;
      this._disconnectReportStream(false);
      if (
        !this._unmounted &&
        this.props.webSocketEnabled !== false &&
        typeof WebSocket !== 'undefined'
      ) {
        void this._poll();
      }
      if (!this._unmounted && this.props.webSocketEnabled !== false) {
        clearTimeout(this._wsReconnectTimer);
        this._wsReconnectTimer = setTimeout(
          () => this._connectReportStream(),
          2500
        );
      }
    };

    ws.onerror = () => {
      /* onclose runs next */
    };

    this._scheduleWsStallFallback();
  }

  /**
   * Fabric-shaped ZMQ fanout from {@code /quotes/stream} (not a full snapshot).
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
   */
  _applyReportBody (body) {
    if (this._unmounted || !body || typeof body !== 'object') return;

    const quoteSym = QUOTE_SYMBOL;

    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const spotsBySymbol = {};
    const sourceCountBySymbol = {};

    const failures = [];

    const btcRow = values[quoteSym];
    const price =
      btcRow && btcRow.price != null ? Number(btcRow.price) : NaN;
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

    let nextQuotes = this.state.quotes;
    const leadPrice = price;

    const fiatEarly =
      body.quoteCurrency != null && String(body.quoteCurrency).trim() !== ''
        ? String(body.quoteCurrency).trim().toUpperCase()
        : this.props.currency;

    const priceHist = body.priceHistory;
    const hasServerHistory =
      Array.isArray(priceHist) && priceHist.length > 0;

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
      pollError: failures.length ? failures.join(' · ') : null
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

    this._clearWsStallFallback();

    if (!this._unmounted) {
      this.setState({
        ...patch,
        reportLoading: false
      });
    }
  }

  /**
   * One-shot or interval {@code GET /quotes/snapshot}; not used when push updates are sufficient.
   */
  async _poll () {
    if (this._pollInFlight) return;
    this._pollInFlight = true;

    const ac = new AbortController();
    this._pollAbort = ac;

    try {
      const fetchJson = async (url, required = false) => {
        const res = await fetch(url, {
          signal: ac.signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          referrerPolicy: 'no-referrer-when-downgrade'
        });
        if (!res.ok) {
          if (required) {
            throw new Error(`${res.status} ${res.statusText}`);
          }
          return null;
        }
        return res.json();
      };

      let body;
      try {
        const [spot, providers, history, chain] = await Promise.all([
          fetchJson(resolveQuotesSpotUrl(this.props.feedApiBase), true),
          fetchJson(resolveQuotesProvidersUrl(this.props.feedApiBase), false),
          fetchJson(
            `${resolveQuotesHistoryUrl(this.props.feedApiBase)}?limit=${MAX_QUOTE_HISTORY}`,
            false
          ),
          fetchJson(resolveQuotesChainUrl(this.props.feedApiBase), false)
        ]);
        body = {
          ...(spot && typeof spot === 'object' ? spot : {}),
          ...(providers && typeof providers === 'object' ? providers : {}),
          ...(history && typeof history === 'object' ? history : {}),
          ...(chain && typeof chain === 'object' ? chain : {})
        };
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // compatibility fallback while instances roll out split endpoints
        try {
          const res = await fetch(resolveQuotesSnapshotUrl(this.props.feedApiBase), {
            signal: ac.signal,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            referrerPolicy: 'no-referrer-when-downgrade'
          });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          body = await res.json();
        } catch (fallbackErr) {
          if (fallbackErr?.name === 'AbortError') return;
          const msg = fallbackErr?.message || String(fallbackErr);
          if (!this._unmounted) {
            this.setState({ pollError: msg });
          }
          return;
        }
      }

      if (this._unmounted) return;
      this._applyReportBody(body);
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
      sourceVisibility
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
          <Header><code>fiat.fabric.pub</code></Header>
          {this.state.reportLoading && !this.state.pollError ? (
            <Message info size="small">
              {wsPrimary ? (
                <>
                  Connecting to{' '}
                  <code>{resolveQuotesStreamUrl(this.props.feedApiBase)}</code>…
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
                ? `BTC → ${fiat} · weighted (${btcSourceCount} source${btcSourceCount === 1 ? '' : 's'})`
                : `BTC → ${fiat}`
            }
            trailing={
              typeof leadUsd === 'number' && Number.isFinite(leadUsd) ? (
                <DeltaInline delta={delta} fiat={fiat} />
              ) : null
            }
            aside={
              showHeadlineSourceColumn ? (
                <HeadlineSourceQuotes
                  quote={headlineQuote}
                  sourceVisibility={sourceVisibility}
                  labelById={labelById}
                  fiat={fiat}
                  tlsByProvider={tlsByProvider}
                  onOpenInspect={this._openInspectQuote}
                />
              ) : null
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
