'use strict';

/**
 * Price history chart: live {@link Feed} samples plus optional daily OHLC context.
 * Y-scale uses **only** points inside the visible time window so off-window history
 * cannot compress the axis (stale “wrong” lows/highs).
 */

import { Component, createRef } from 'react';

import { Header, Segment } from 'semantic-ui-react';

import * as Plot from '@observablehq/plot';

import { formatFiatPrice } from './localeNumber';

const QUOTE_SYMBOL = 'BTC';

/** Windows for chart + overview delta (sorted shortest → longest). */
export const DELTA_RANGE_OPTIONS = [
  { key: '1m', label: '1m', ms: 60_000 },
  { key: '5m', label: '5m', ms: 5 * 60_000 },
  { key: '15m', label: '15m', ms: 15 * 60_000 },
  { key: '1h', label: '1h', ms: 60 * 60_000 },
  { key: '3h', label: '3h', ms: 3 * 60 * 60_000 },
  { key: '4h', label: '4h', ms: 4 * 60 * 60_000 },
  { key: '12h', label: '12h', ms: 12 * 60 * 60_000 },
  { key: '24h', label: '24h', ms: 24 * 60 * 60_000 },
  { key: '2d', label: '2d', ms: 2 * 24 * 60 * 60_000 },
  { key: '7d', label: '7d', ms: 7 * 24 * 60 * 60_000 },
  { key: '14d', label: '14d', ms: 14 * 24 * 60 * 60_000 },
  { key: '30d', label: '30d', ms: 30 * 24 * 60 * 60_000 },
  { key: '90d', label: '90d', ms: 90 * 24 * 60 * 60_000 },
  { key: '365d', label: '1y', ms: 365 * 24 * 60 * 60_000 },
  { key: 'all', label: 'All time', ms: null }
];

/** Shown as toggle buttons; additional ranges live in the “More ranges” menu. */
export const DELTA_RANGE_QUICK_KEYS = new Set([
  '1m', '15m', '1h', '4h', '24h', '7d', '30d'
]);

export const DELTA_RANGE_DEFAULT_KEY = '1h';

/**
 * @param {string|undefined} deltaRangeKey
 */
export function resolveDeltaRangeOption (deltaRangeKey) {
  const k =
    typeof deltaRangeKey === 'string' && deltaRangeKey
      ? deltaRangeKey
      : DELTA_RANGE_DEFAULT_KEY;
  const found = DELTA_RANGE_OPTIONS.find((r) => r.key === k);
  if (found) return found;
  return (
    DELTA_RANGE_OPTIONS.find((r) => r.key === DELTA_RANGE_DEFAULT_KEY) ||
    DELTA_RANGE_OPTIONS[0]
  );
}

/**
 * Baseline quote for Δ: for a fixed window, latest sample at or before `nowMs - rangeMs`;
 * for **all-time** (`rangeMs == null`), the **oldest** session sample.
 *
 * @param {Array<{ created?: string, rate?: number }>} quotes
 * @param {number|null} rangeMs
 * @param {number} [nowMs]
 * @returns {{ created: string, rate: number } | null}
 */
export function baselineQuoteForWindow (quotes, rangeMs, nowMs = Date.now()) {
  if (!Array.isArray(quotes) || quotes.length < 1) return null;
  const sorted = [].concat(quotes).sort(
    (a, b) => Date.parse(a.created) - Date.parse(b.created)
  );

  if (rangeMs == null) {
    let oldest = null;
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      if (!row || row.rate == null || !row.created) continue;
      const t = Date.parse(row.created);
      if (!Number.isFinite(t)) continue;
      if (
        !oldest ||
        t < Date.parse(oldest.created)
      ) {
        oldest = row;
      }
    }
    return oldest;
  }

  const cutoff = nowMs - rangeMs;
  let best = null;
  let bestTs = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (!row || row.rate == null || !row.created) continue;
    const t = Date.parse(row.created);
    if (!Number.isFinite(t)) continue;
    if (t <= cutoff && t >= bestTs) {
      bestTs = t;
      best = row;
    }
  }
  return best;
}

/**
 * @param {number} spot
 * @param {Array<{ created?: string, rate?: number }>} quotes
 * @param {{ key: string, label: string, ms: number|null }} rangeOpt
 */
export function deltaForRange (spot, quotes, rangeOpt) {
  if (!Number.isFinite(spot)) {
    return { state: 'nospot' };
  }
  const baseRow = baselineQuoteForWindow(quotes, rangeOpt.ms);
  if (!baseRow) {
    return { state: 'nodata' };
  }
  const base = Number(baseRow.rate);
  if (!Number.isFinite(base) || base === 0) {
    return { state: 'nodata' };
  }
  const abs = spot - base;
  const pct = (abs / base) * 100;
  let direction = 'flat';
  if (Math.abs(pct) >= 1e-6) {
    direction = pct > 0 ? 'up' : 'down';
  }
  return {
    state: 'ok',
    direction,
    pct,
    abs,
    baseline: base,
    baselineLabel: rangeOpt.label
  };
}

/**
 * @param {Array<{ created?: string, rate?: unknown }>} rows
 */
function dedupeByTimestampKeepLatest (rows) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  const sorted = [].concat(rows).sort(
    (a, b) => Date.parse(a.created) - Date.parse(b.created)
  );
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (!r?.created) continue;
    const t = Date.parse(r.created);
    if (!Number.isFinite(t)) continue;
    const prev = out[out.length - 1];
    if (prev && Date.parse(prev.created) === t) {
      out[out.length - 1] = r;
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * @param {Array<{ created?: string, rate?: unknown }>} rows
 */
function dropBadRates (rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.created) continue;
    const p = Number(r.rate);
    if (!Number.isFinite(p) || p <= 0) continue;
    const t = Date.parse(r.created);
    if (!Number.isFinite(t)) continue;
    out.push(r);
  }
  return out;
}

/**
 * Y domain from rates only (padding), or undefined if no usable points.
 * @param {Array<{ rate?: unknown }>} rows
 * @param {number} padRatio
 * @returns {[number, number]|undefined}
 */
function yDomainFromRates (rows, padRatio = 0.018) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const p = Number(rows[i]?.rate);
    if (!Number.isFinite(p)) continue;
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  if (lo === hi) {
    const d = Math.max(lo * 0.002, 1);
    return [lo - d, hi + d];
  }
  const pad = (hi - lo) * padRatio;
  return [lo - pad, hi + pad];
}

export default class Chart extends Component {
  static defaultProps = {
    currency: 'USD',
    historicalOhlcUrl: 'data/btc-usd-daily-ohlc.json',
    pollError: null,
    utxoEstimateSeries: null,
    utxoEstimateSeriesLoading: false
  };

  state = {
    historicalSeries: [],
    historicalLoadState: 'idle',
    /** Mouse-wheel zoom override for current chart window (milliseconds). */
    zoomWindowMs: null
  };

  constructor (props = {}) {
    super(props);

    this.chartOuterRef = createRef();
    /** @type {ResizeObserver|null} */
    this._chartResizeObs = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._chartResizeTimer = null;
    this._unmounted = false;

    this._chartRowsFromOhlcBundle = this._chartRowsFromOhlcBundle.bind(this);
    this._handleWheelZoom = this._handleWheelZoom.bind(this);
  }

  /**
   * Merge Coinbase + Bitstamp closes per `periodStartSec` (simple mean when both exist).
   * @param {unknown} bundle
   * @returns {Array<{ created: string, rate: number, symbol: string, source: string }>}
   */
  _chartRowsFromOhlcBundle (bundle) {
    if (!bundle || typeof bundle !== 'object') return [];
    const prov = /** @type {{ coinbase?: unknown[], bitstamp?: unknown[] }} */ (
      bundle.providers && typeof bundle.providers === 'object'
        ? bundle.providers
        : {}
    );
    const cb = Array.isArray(prov.coinbase) ? prov.coinbase : [];
    const bs = Array.isArray(prov.bitstamp) ? prov.bitstamp : [];
    if (!cb.length && !bs.length) return [];

    /** @type {Map<number, { sum: number, n: number }>} */
    const bySec = new Map();
    const add = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (!c || typeof c !== 'object') continue;
        const sec = Number(/** @type {{ periodStartSec?: unknown }} */ (c).periodStartSec);
        const cl = Number(/** @type {{ close?: unknown }} */ (c).close);
        if (!Number.isFinite(sec) || !Number.isFinite(cl)) continue;
        const ex = bySec.get(sec);
        if (ex) {
          ex.sum += cl;
          ex.n += 1;
        } else {
          bySec.set(sec, { sum: cl, n: 1 });
        }
      }
    };
    add(cb);
    add(bs);

    const sorted = [...bySec.entries()].sort((a, b) => a[0] - b[0]);
    return sorted.map(([sec, { sum, n }]) => ({
      created: new Date(sec * 1000).toISOString(),
      rate: sum / n,
      symbol: QUOTE_SYMBOL,
      source: 'Daily close (avg.)'
    }));
  }

  _resolveAssetUrl (rel) {
    const s = String(rel || '').trim();
    if (!s || typeof window === 'undefined' || !window.location?.href) return null;
    try {
      return new URL(s, window.location.href).href;
    } catch {
      return null;
    }
  }

  _loadHistoricalOhlc () {
    const rel = this.props.historicalOhlcUrl;
    const url = this._resolveAssetUrl(rel);
    if (!url) {
      this.setState({ historicalLoadState: 'off' });
      return;
    }

    this.setState({ historicalLoadState: 'loading' });

    fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer-when-downgrade'
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((bundle) => {
        if (this._unmounted) return;
        if (!bundle) {
          this.setState({ historicalSeries: [], historicalLoadState: 'missing' });
          return;
        }
        const rows = this._chartRowsFromOhlcBundle(bundle);
        this.setState(
          {
            historicalSeries: rows,
            historicalLoadState: rows.length ? 'ok' : 'empty'
          }
        );
      })
      .catch(() => {
        if (!this._unmounted) {
          this.setState({ historicalSeries: [], historicalLoadState: 'error' });
        }
      });
  }

  componentDidMount () {
    this._unmounted = false;
    this._loadHistoricalOhlc();

    const mount = this.chartOuterRef?.current;
    if (mount && typeof ResizeObserver !== 'undefined') {
      this._chartResizeObs = new ResizeObserver(() => {
        if (this._chartResizeTimer) clearTimeout(this._chartResizeTimer);
        this._chartResizeTimer = setTimeout(() => {
          this._chartResizeTimer = null;
          if (!this._unmounted) this._syncChartIntoDom();
        }, 70);
      });
      this._chartResizeObs.observe(mount);
    }
    if (mount) {
      mount.addEventListener('wheel', this._handleWheelZoom, { passive: false });
    }
  }

  componentWillUnmount () {
    const mount = this.chartOuterRef?.current;
    if (mount) {
      try {
        mount.removeEventListener('wheel', this._handleWheelZoom);
      } catch {
        /* noop */
      }
    }
    if (this._chartResizeObs) {
      try {
        this._chartResizeObs.disconnect();
      } catch {
        /* noop */
      }
      this._chartResizeObs = null;
    }
    if (this._chartResizeTimer) {
      clearTimeout(this._chartResizeTimer);
      this._chartResizeTimer = null;
    }
    this._unmounted = true;
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevProps.deltaRangeKey !== this.props.deltaRangeKey) {
      this.setState({ zoomWindowMs: null });
      return;
    }
    if (
      prevProps.quotes !== this.props.quotes ||
      prevProps.deltaRangeKey !== this.props.deltaRangeKey ||
      prevProps.reportQuoteCurrency !== this.props.reportQuoteCurrency ||
      prevProps.pollError !== this.props.pollError ||
      prevProps.currency !== this.props.currency ||
      prevProps.utxoEstimateSeries !== this.props.utxoEstimateSeries ||
      prevState.historicalSeries !== this.state.historicalSeries
    ) {
      this._syncChartIntoDom();
    }
  }

  /**
   * Mouse wheel zoom for the active chart range.
   * - zoom in: wheel up
   * - zoom out: wheel down
   * Disabled for all-time range.
   * @param {WheelEvent} ev
   */
  _handleWheelZoom (ev) {
    const rangeOpt = resolveDeltaRangeOption(this.props.deltaRangeKey);
    if (rangeOpt.ms == null) return;
    if (this._unmounted) return;
    ev.preventDefault();

    const baseMs =
      Number.isFinite(this.state.zoomWindowMs) && this.state.zoomWindowMs > 0
        ? this.state.zoomWindowMs
        : rangeOpt.ms;
    const factor = ev.deltaY < 0 ? 0.82 : 1.22;

    const quoteRows = Array.isArray(this.props.quotes) ? this.props.quotes : [];
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (let i = 0; i < quoteRows.length; i++) {
      const t = Date.parse(String(quoteRows[i]?.created ?? ''));
      if (!Number.isFinite(t)) continue;
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
    }
    const observedSpanMs =
      Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs
        ? maxTs - minTs
        : 24 * 60 * 60 * 1000;
    const minMs = 15_000;
    const maxMs = Math.max(observedSpanMs * 1.25, rangeOpt.ms * 4, 15 * 60_000);
    const nextMs = Math.max(minMs, Math.min(maxMs, Math.round(baseMs * factor)));
    this.setState({ zoomWindowMs: nextMs });
  }

  _syncChartIntoDom () {
    const run = () => {
      const mount = this.chartOuterRef?.current;
      if (!mount) return;
      while (mount.firstChild) {
        mount.removeChild(mount.firstChild);
      }
      const svg = this._buildChartSvgEl();
      if (svg) {
        mount.appendChild(svg);
      }
    };
    run();
    requestAnimationFrame(run);
  }

  _chartWidth () {
    const el = this.chartOuterRef?.current;
    if (!el) return 560;
    const w = el.getBoundingClientRect?.().width;
    if (Number.isFinite(w) && w > 24) return Math.floor(w);
    const parent = el.parentElement;
    const pw = parent?.getBoundingClientRect?.().width;
    if (Number.isFinite(pw) && pw > 24) return Math.floor(pw);
    return 560;
  }

  /**
   * @param {Array<{ created?: string }>} rows
   * @param {number} startMs
   * @param {number} endMs
   */
  _filterPointsInRange (rows, startMs, endMs) {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r?.created) continue;
      const t = Date.parse(r.created);
      if (!Number.isFinite(t)) continue;
      if (t >= startMs && t <= endMs) out.push(r);
    }
    return out;
  }

  _buildChartSvgEl () {
    const nowMs = Date.now();
    const rangeOpt = resolveDeltaRangeOption(this.props.deltaRangeKey);
    const zoomWindowMs =
      Number.isFinite(this.state.zoomWindowMs) && this.state.zoomWindowMs > 0
        ? this.state.zoomWindowMs
        : null;
    const effectiveWindowMs =
      rangeOpt.ms == null ? null : (zoomWindowMs ?? rangeOpt.ms);
    const allTime = effectiveWindowMs == null;

    let quotes = dropBadRates(
      dedupeByTimestampKeepLatest(this.props.quotes || [])
    );
    quotes = quotes.sort(
      (a, b) => Date.parse(a.created) - Date.parse(b.created)
    );

    const historicalRaw = dropBadRates(
      [].concat(this.state.historicalSeries || []).sort(
        (a, b) => Date.parse(a.created) - Date.parse(b.created)
      )
    );

    const liveStartMs =
      quotes.length && quotes[0].created
        ? Date.parse(quotes[0].created)
        : Infinity;

    const historicalContext = historicalRaw.filter((h) => {
      if (!h?.created) return false;
      const t = Date.parse(h.created);
      return Number.isFinite(t) && t < liveStartMs;
    });

    /** @type {Array<{ height?: number, price?: number, asOfMs?: number }>} */
    const utxoSeriesRaw = Array.isArray(this.props.utxoEstimateSeries)
      ? this.props.utxoEstimateSeries
      : [];

    if (
      !quotes.length &&
      !historicalContext.length &&
      !utxoSeriesRaw.length
    ) {
      return undefined;
    }

    let startMs;
    const endMs = nowMs;
    /** @type {typeof quotes} */
    let historicalInWin;
    /** @type {typeof quotes} */
    let liveInWin;

    if (allTime) {
      historicalInWin = historicalContext;
      liveInWin = quotes;
      const times = [];
      for (let i = 0; i < historicalInWin.length; i++) {
        const t = Date.parse(historicalInWin[i].created);
        if (Number.isFinite(t)) times.push(t);
      }
      for (let i = 0; i < liveInWin.length; i++) {
        const t = Date.parse(liveInWin[i].created);
        if (Number.isFinite(t)) times.push(t);
      }
      for (let i = 0; i < utxoSeriesRaw.length; i++) {
        const ms = Number(utxoSeriesRaw[i]?.asOfMs);
        if (Number.isFinite(ms)) times.push(ms);
      }
      startMs = times.length ? Math.min(...times) : nowMs - 60_000;
    } else {
      const windowMs = /** @type {number} */ (effectiveWindowMs);
      startMs = nowMs - windowMs;
      historicalInWin = this._filterPointsInRange(
        historicalContext,
        startMs,
        nowMs
      );
      liveInWin = this._filterPointsInRange(quotes, startMs, nowMs);
    }

    /** @type {Array<{ t: Date, price: number, height: number }>} */
    const utxoInWin = [];
    const liveForCompare = [].concat(liveInWin).sort(
      (a, b) => Date.parse(a.created) - Date.parse(b.created)
    );
    /**
     * @param {number} ms
     * @returns {number|null}
     */
    const feedPriceAtOrBefore = (ms) => {
      let out = null;
      let outTs = -Infinity;
      for (let i = 0; i < liveForCompare.length; i++) {
        const row = liveForCompare[i];
        const ts = Date.parse(row.created);
        if (!Number.isFinite(ts) || ts > ms || ts < outTs) continue;
        const px = Number(row.rate);
        if (!Number.isFinite(px) || px <= 0) continue;
        out = px;
        outTs = ts;
      }
      return out;
    };
    for (let i = 0; i < utxoSeriesRaw.length; i++) {
      const p = utxoSeriesRaw[i];
      const price = Number(p?.price);
      const ms = Number(p?.asOfMs);
      const hRaw = p?.height;
      const h = Number(hRaw);
      if (!Number.isFinite(price) || !Number.isFinite(ms)) continue;
      const feedPx = feedPriceAtOrBefore(ms);
      const diffAbs =
        Number.isFinite(feedPx) ? price - /** @type {number} */ (feedPx) : null;
      const diffPct =
        Number.isFinite(feedPx) && feedPx !== 0
          ? (diffAbs / feedPx) * 100
          : null;
      utxoInWin.push({
        t: new Date(ms),
        price,
        height: Number.isFinite(h) ? Math.floor(h) : i,
        feedPrice: Number.isFinite(feedPx) ? feedPx : null,
        diffAbs,
        diffPct
      });
    }

    let plotStartMs = startMs;
    let plotEndMs = endMs;
    for (let ui = 0; ui < utxoInWin.length; ui++) {
      const tx = utxoInWin[ui].t.getTime();
      if (!Number.isFinite(tx)) continue;
      if (tx < plotStartMs) plotStartMs = tx;
      if (tx > plotEndMs) plotEndMs = tx;
    }

    if (
      !historicalInWin.length &&
      !liveInWin.length &&
      !utxoInWin.length
    ) {
      return undefined;
    }

    const yDomain = yDomainFromRates([
      ...historicalInWin,
      ...liveInWin,
      ...utxoInWin.map((u) => ({ rate: u.price }))
    ]);

    const histMapped = historicalInWin.map((x) => ({
      ...x,
      created: new Date(x.created)
    }));
    const liveMapped = liveInWin.map((x) => ({
      ...x,
      created: new Date(x.created)
    }));

    const width = Math.min(920, Math.max(280, this._chartWidth()));
    const height = Math.max(220, Math.round(width * 0.42));

    const fiat =
      this.props.reportQuoteCurrency != null &&
      String(this.props.reportQuoteCurrency).trim() !== ''
        ? String(this.props.reportQuoteCurrency).trim().toUpperCase()
        : this.props.currency;

    /** @type {unknown[]} */
    const dataMarks = [];

    if (historicalInWin.length === 1) {
      dataMarks.push(
        Plot.dot(histMapped, {
          x: 'created',
          y: 'rate',
          fill: 'rgba(120,140,160,0.55)',
          r: 2.5
        })
      );
    } else if (historicalInWin.length > 1) {
      dataMarks.push(
        Plot.line(histMapped, {
          x: 'created',
          y: 'rate',
          stroke: 'rgba(120,140,160,0.55)',
          strokeWidth: 1.25
        })
      );
    }

    if (liveInWin.length === 1) {
      dataMarks.push(
        Plot.dot(liveMapped, {
          x: 'created',
          y: 'rate',
          fill: 'currentColor',
          r: 3
        })
      );
    } else if (liveInWin.length > 1) {
      dataMarks.push(
        Plot.line(liveMapped, {
          x: 'created',
          y: 'rate',
          stroke: 'currentColor',
          strokeWidth: 1.85
        })
      );
    }

    if (!dataMarks.length && !utxoInWin.length) return undefined;

    /** @type {unknown[]} */
    const marks = [];

    const baselineRow = baselineQuoteForWindow(quotes, rangeOpt.ms, nowMs);
    if (
      baselineRow &&
      baselineRow.created &&
      Number.isFinite(Number(baselineRow.rate))
    ) {
      const bt = Date.parse(baselineRow.created);
      if (Number.isFinite(bt) && bt >= startMs && bt <= nowMs) {
        marks.push(
          Plot.ruleX([new Date(bt)], {
            stroke: 'rgba(34,36,38,0.22)',
            strokeWidth: 1.5,
            strokeDasharray: '4 3'
          })
        );
      }
    }

    marks.push(...dataMarks);

    const utxoDotR = utxoInWin.length > 200 ? 2 : utxoInWin.length > 80 ? 2.5 : 3;
    /**
     * @param {{ height: number, price: number, feedPrice?: number|null, diffAbs?: number|null, diffPct?: number|null }} d
     */
    const utxoHoverTitle = (d) => {
      const parts = [
        `UTXOracle h ${d.height}`,
        formatFiatPrice(d.price, fiat)
      ];
      if (Number.isFinite(d.feedPrice)) {
        parts.push(`Feed ${formatFiatPrice(d.feedPrice, fiat)}`);
      }
      if (Number.isFinite(d.diffAbs) && Number.isFinite(d.diffPct)) {
        const abs = /** @type {number} */ (d.diffAbs);
        const pct = /** @type {number} */ (d.diffPct);
        const sign = abs > 0 ? '+' : '';
        parts.push(`Diff ${sign}${formatFiatPrice(abs, fiat)} (${sign}${pct.toFixed(2)}%)`);
      }
      return parts.join(' · ');
    };

    if (utxoInWin.length) {
      marks.push(
        Plot.line(utxoInWin, {
          x: 't',
          y: 'price',
          stroke: 'rgba(132, 57, 168, 0.95)',
          strokeWidth: 1.4
        })
      );
      marks.push(
        Plot.dot(utxoInWin, {
          x: 't',
          y: 'price',
          fill: 'rgba(168, 85, 200, 0.9)',
          stroke: 'rgba(255,255,255,0.35)',
          strokeWidth: 0.4,
          r: utxoDotR,
          title: utxoHoverTitle
        })
      );
    }

    return Plot.plot({
      width,
      height,
      marginBottom: 50,
      marginLeft: 72,
      x: {
        type: 'utc',
        label: 'Time',
        tickRotate: 35,
        domain: [new Date(plotStartMs), new Date(plotEndMs)]
      },
      y: {
        label: `BTC / ${fiat}`,
        grid: true,
        tickFormat: (/** @type {number} */ d) => formatFiatPrice(Number(d), fiat),
        ...(yDomain ? { domain: yDomain } : {})
      },
      marks
    });
  }

  render () {
    const sectionLabel = this.props.sectionLabel ?? 'History';

    return (
      <>
        <Header dividing>{sectionLabel}</Header>
        <Segment>
          <div
            ref={this.chartOuterRef}
            className="feed-monitor-chart-mount"
            style={{ minHeight: '240px', width: '100%' }}
          />
          <p
            className="feed-monitor-chart-caption"
            style={{
              margin: '0.65rem 0 0',
              fontSize: '0.82rem',
              opacity: 0.62,
              textAlign: 'center'
            }}
          >
            <>
              {this.state.historicalLoadState === 'ok' ? (
                <>
                  <strong>Live</strong> feed samples (foreground) and{' '}
                  <strong>daily</strong> OHLC average (Coinbase + Bitstamp, background).
                </>
              ) : this.state.historicalLoadState === 'loading' ? (
                <>Loading reference history…</>
              ) : this.state.historicalLoadState === 'missing' ||
                this.state.historicalLoadState === 'error' ? (
                <>
                  Live feed only — add <code>data/btc-usd-daily-ohlc.json</code> beside the UI to show long-range context.
                </>
              ) : (
                <>Live feed samples.</>
              )}
              {Array.isArray(this.props.utxoEstimateSeries) &&
              this.props.utxoEstimateSeries.length > 0 ? (
                <>
                  {' '}
                  <strong style={{ color: 'rgba(132, 57, 168, 0.95)' }}>Violet line + dots</strong> are
                  on-chain <strong>UTXOracle</strong> estimates (hover for block height, UTXOracle price,
                  and delta vs feed).
                </>
              ) : null}
              {this.props.utxoEstimateSeriesLoading ? (
                <> Loading UTXOracle block estimates…</>
              ) : null}
            </>
          </p>
        </Segment>
      </>
    );
  }
}
