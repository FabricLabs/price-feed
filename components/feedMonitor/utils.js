'use strict';

import { quoteAsOfMs } from '../../types/quoteTime.js';
import { formatFiatPrice } from '../localeNumber.js';

export const QUOTE_SYMBOL = 'BTC';

export const MAX_QUOTE_ROWS = 24;
export const MAX_QUOTE_HISTORY = 2048;

/**
 * @param {string} [feedApiBase]
 * @returns {string}
 */
export function resolveFeedReportUrl (feedApiBase) {
  const base = String(feedApiBase ?? '').trim().replace(/\/+$/, '');
  if (base) {
    return `${base}/feed/report`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      return new URL('/feed/report', window.location.origin).href;
    } catch {
      /* fall through */
    }
  }
  return '/feed/report';
}

/** Same origin path as {@link resolveFeedReportUrl} for the plain-JSON report stream (not Fabric Bridge). */
export const FEED_REPORT_STREAM_PATH = '/feed/stream';

/**
 * WebSocket URL for {@link FEED_REPORT_STREAM_PATH} (Hub Bridge stays on `/` with Fabric frames).
 * @param {string} [feedApiBase]
 * @returns {string}
 */
export function resolveFeedStreamUrl (feedApiBase) {
  const base = String(feedApiBase ?? '').trim().replace(/\/+$/, '');
  if (base) {
    if (/^https:\/\//i.test(base)) {
      return `wss://${base.slice('https://'.length)}${FEED_REPORT_STREAM_PATH}`;
    }
    if (/^http:\/\//i.test(base)) {
      return `ws://${base.slice('http://'.length)}${FEED_REPORT_STREAM_PATH}`;
    }
    try {
      const u = new URL(base, 'http://localhost');
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${u.host}${FEED_REPORT_STREAM_PATH}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined' && window.location?.host) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${FEED_REPORT_STREAM_PATH}`;
  }
  return `ws://127.0.0.1:3000${FEED_REPORT_STREAM_PATH}`;
}

/**
 * @param {string} [feedApiBase]
 * @returns {string}
 */
export function resolveUtxOracleEstimateUrl (feedApiBase) {
  const base = String(feedApiBase ?? '').trim().replace(/\/+$/, '');
  if (base) {
    return `${base}/feed/utxoracle/estimate`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      return new URL('/feed/utxoracle/estimate', window.location.origin).href;
    } catch {
      /* fall through */
    }
  }
  return '/feed/utxoracle/estimate';
}

/**
 * @param {string} [feedApiBase]
 * @returns {string}
 */
export function resolveUtxOracleEstimateSeriesUrl (feedApiBase) {
  const base = String(feedApiBase ?? '').trim().replace(/\/+$/, '');
  if (base) {
    return `${base}/feed/utxoracle/estimate-series`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      return new URL('/feed/utxoracle/estimate-series', window.location.origin).href;
    } catch {
      /* fall through */
    }
  }
  return '/feed/utxoracle/estimate-series';
}

/**
 * @param {Array<{ price?: unknown, age?: unknown, asOfMs?: unknown, created?: unknown }>} sources
 * @param {number} [nowMs]
 * @returns {number|null}
 */
export function weightedPriceFromSerializedSources (sources, nowMs = Date.now()) {
  if (!Array.isArray(sources) || !sources.length) return null;
  let mass = 0;
  let sum = 0;
  for (let i = 0; i < sources.length; i++) {
    const quote = sources[i];
    if (quote?.excludedFromSpot === true) continue;
    const price = Number(quote?.price);
    if (!Number.isFinite(price)) continue;
    const asOf = quoteAsOfMs(quote);
    let age;
    if (Number.isFinite(asOf)) {
      age = Math.log(Math.max(1, nowMs - asOf));
    } else {
      const ageRaw = Number(quote?.age);
      age =
        Number.isFinite(ageRaw) && ageRaw > 0 ? ageRaw : 1;
    }
    const weight = 1 / Math.max(age, 1e-9);
    mass += weight;
    sum += weight * price;
  }
  if (mass <= 0 || !Number.isFinite(sum)) return null;
  return sum / mass;
}

/**
 * @param {string|undefined|null} providerId
 * @param {Record<string, boolean>} visibility
 */
export function isSourceVisible (providerId, visibility) {
  if (providerId == null || String(providerId).trim() === '') return false;
  return visibility[String(providerId)] !== false;
}

/**
 * @param {object} row
 * @param {Record<string, boolean>} sourceVisibility
 */
export function filterQuoteRowBySourceVisibility (row, sourceVisibility) {
  if (!row || typeof row !== 'object') return null;
  if (!Array.isArray(row.sources) || row.sources.length === 0) {
    return row;
  }
  const filtered = row.sources.filter((s) =>
    isSourceVisible(
      /** @type {{ provider?: string }} */ (s)?.provider,
      sourceVisibility
    )
  );
  if (filtered.length === 0) return null;
  const price = weightedPriceFromSerializedSources(filtered);
  if (price == null || !Number.isFinite(price)) return null;
  const blendCount = filtered.filter(
    (s) => /** @type {{ excludedFromSpot?: boolean }} */ (s).excludedFromSpot !== true
  ).length;
  return {
    ...row,
    rate: price,
    sourceCount: blendCount,
    sources: filtered
  };
}

/**
 * @param {unknown[]} quotes
 * @param {Record<string, boolean>} sourceVisibility
 */
export function filterQuotesBySourceVisibility (quotes, sourceVisibility) {
  if (!Array.isArray(quotes)) return [];
  const vis = sourceVisibility && typeof sourceVisibility === 'object' ? sourceVisibility : {};
  return quotes
    .map((row) => filterQuoteRowBySourceVisibility(row, vis))
    .filter(Boolean);
}

/**
 * @param {unknown[]} quoteProviders
 * @param {unknown[]} quotes
 * @returns {string[]}
 */
export function providerIdsForFilter (quoteProviders, quotes) {
  const list = Array.isArray(quoteProviders) ? quoteProviders : [];
  if (list.length) {
    return list
      .map((p) => (p && p.id != null ? String(p.id) : ''))
      .filter((id) => id !== '');
  }
  const set = new Set();
  const q = Array.isArray(quotes) ? quotes : [];
  for (let i = 0; i < q.length; i++) {
    const src = /** @type {{ sources?: unknown[] }} */ (q[i])?.sources;
    if (!Array.isArray(src)) continue;
    for (let j = 0; j < src.length; j++) {
      const id = /** @type {{ provider?: string }} */ (src[j])?.provider;
      if (id != null && String(id).trim() !== '') set.add(String(id));
    }
  }
  return [...set].sort();
}

/**
 * @param {unknown[]} priceHistory
 * @param {string} symbol
 * @param {string} currency
 */
export function chartQuotesFromPriceHistory (priceHistory, symbol, currency) {
  if (!Array.isArray(priceHistory) || !symbol) return [];
  const out = [];
  for (let i = 0; i < priceHistory.length; i++) {
    const row = priceHistory[i];
    if (!row || typeof row !== 'object') continue;
    const values =
      row.values && typeof row.values === 'object' ? row.values : null;
    if (!values) continue;
    const raw = values[symbol];
    if (!raw || raw.price == null) continue;
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const tsRaw = /** @type {{ ts?: number }} */ (row).ts;
    const ts =
      typeof tsRaw === 'number'
        ? tsRaw
        : Date.parse(String(tsRaw));
    if (!Number.isFinite(ts)) continue;

    const scRaw = raw.sourceCount;
    const sc =
      scRaw != null && Number.isFinite(Number(scRaw))
        ? Number(scRaw)
        : undefined;
    const contrib = Array.isArray(raw.sources)
      ? raw.sources.slice()
      : undefined;

    out.push({
      created: new Date(ts).toISOString(),
      rate: price,
      currency: currency || 'USD',
      symbol,
      source: 'Feed',
      ...(sc !== undefined ? { sourceCount: sc } : {}),
      ...(contrib && contrib.length ? { sources: contrib } : {})
    });
  }
  return out;
}

/**
 * @param {Record<string, unknown>|null|undefined} quotesBySymbol
 * @param {Intl.NumberFormat} nf
 */
/**
 * @param {unknown} quotesBySymbol
 */
export function formatProviderQuotesLine (quotesBySymbol) {
  if (!quotesBySymbol || typeof quotesBySymbol !== 'object') return '—';
  const keys = Object.keys(quotesBySymbol).sort();
  if (!keys.length) return '—';
  const parts = [];
  for (let i = 0; i < keys.length; i++) {
    const sym = keys[i];
    const q = /** @type {{ price?: unknown, currency?: unknown, fromCache?: boolean }} */ (
      quotesBySymbol[sym]
    );
    if (!q || typeof q !== 'object') continue;
    const p = Number(q.price);
    const cur = q.currency != null ? String(q.currency) : 'USD';
    const frag =
      Number.isFinite(p)
        ? `${sym} ${formatFiatPrice(p, cur)}`
        : `${sym} (n/a)`;
    let line = q.fromCache ? `${frag} (cache)` : frag;
    if (q.excludedFromSpot === true) {
      line += ' · not in spot';
    }
    parts.push(line);
  }
  return parts.length ? parts.join(' · ') : '—';
}

/**
 * Human-readable TLS certificate issuer ("signer") from Node/OpenSSL-style fields.
 * @param {unknown} issuer
 * @returns {string|null}
 */
export function formatCertificateIssuer (issuer) {
  if (issuer == null) return null;
  if (typeof issuer === 'string') {
    const t = issuer.trim();
    return t || null;
  }
  if (typeof issuer !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (issuer);

  const one = (k) => {
    const v = o[k];
    if (v == null) return '';
    if (Array.isArray(v)) {
      return v
        .map((x) => String(x).trim())
        .filter(Boolean)
        .join(', ');
    }
    return String(v).trim();
  };

  const cn = one('CN');
  const ou = one('OU');
  const oOrg = one('O');

  if (cn && oOrg) return `${cn} · ${oOrg}`;
  if (oOrg && ou) return `${oOrg} · ${ou}`;
  if (oOrg) return oOrg;
  if (cn) return cn;
  const fallback = Object.values(o)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .map((x) => String(x).trim())
    .filter(Boolean);
  return fallback.length ? fallback.join(' · ') : null;
}

/**
 * @param {unknown} tls
 * @returns {boolean}
 */
export function tlsChainTrusted (tls) {
  if (!tls || typeof tls !== 'object') return false;
  const t = /** @type {{ authorized?: unknown, rejected?: unknown }} */ (tls);
  if (t.rejected === true) return false;
  return t.authorized === true;
}

/**
 * @param {unknown} tlsByProvider
 * @param {unknown} providerId
 * @returns {Record<string, unknown>|null}
 */
export function lookupProviderTls (tlsByProvider, providerId) {
  if (!tlsByProvider || providerId == null) return null;
  const id = String(providerId);
  if (tlsByProvider instanceof Map) {
    const v = tlsByProvider.get(id);
    return v && typeof v === 'object'
      ? /** @type {Record<string, unknown>} */ (v)
      : null;
  }
  if (typeof tlsByProvider === 'object' && id in tlsByProvider) {
    const v = /** @type {Record<string, unknown>} */ (tlsByProvider)[id];
    return v && typeof v === 'object'
      ? /** @type {Record<string, unknown>} */ (v)
      : null;
  }
  return null;
}

/**
 * One-line TLS telemetry for the Sources table.
 * @param {unknown} tls
 * @returns {string}
 */
export function formatTlsSummaryLine (tls) {
  if (!tls || typeof tls !== 'object') return '—';
  const t = /** @type {{ authorized?: boolean, serverIdentityOk?: boolean, hostIdentityCheck?: boolean|null, protocol?: unknown, peer?: { validTo?: unknown, issuer?: unknown } | null, authorizationError?: unknown }} */ (
    tls
  );
  if (t.authorized !== true) {
    const why =
      t.authorizationError != null && String(t.authorizationError).trim() !== ''
        ? String(t.authorizationError)
        : 'not authorized';
    return `invalid (${why})`;
  }
  const proto = t.protocol != null ? String(t.protocol) : '';
  const validTo =
    t.peer &&
    typeof t.peer === 'object' &&
    t.peer.validTo != null
      ? String(t.peer.validTo)
      : '';
  const signer = formatCertificateIssuer(
    t.peer && typeof t.peer === 'object' ? t.peer.issuer : null
  );
  const bits = [`valid`];
  if (signer) bits.push(`signer: ${signer}`);
  if (proto) bits.push(proto);
  if (t.hostIdentityCheck === false) bits.push('hostname recheck mismatch');
  if (validTo) bits.push(`to ${validTo}`);
  return bits.join(' · ');
}

/**
 * @param {unknown} ts
 */
export function formatProviderTs (ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

/**
 * @param {unknown} nextFetchAt
 * @param {boolean} enabled
 */
export function formatNextFetch (nextFetchAt, enabled) {
  if (!enabled) return '—';
  if (typeof nextFetchAt !== 'number' || !Number.isFinite(nextFetchAt)) {
    return 'Due';
  }
  const now = Date.now();
  if (nextFetchAt <= now) return 'Due';
  const sec = Math.ceil((nextFetchAt - now) / 1000);
  if (sec < 120) return `in ${sec}s`;
  const min = Math.ceil(sec / 60);
  return `in ${min}m`;
}
