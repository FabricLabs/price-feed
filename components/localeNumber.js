'use strict';

import formatUSD from '../functions/formatUSD.js';

export function locale () {
  return Intl.NumberFormat().resolvedOptions().locale;
}

/**
 * @param {unknown} value
 * @param {{ empty?: string }} [opts]
 */
export function formatLocaleNumber (value, opts = {}) {
  const empty = opts.empty ?? '';
  let n = value;
  if (typeof n !== 'number') n = parseFloat(String(value));
  return typeof n === 'number' && !Number.isNaN(n)
    ? n.toLocaleString(locale())
    : empty;
}

/**
 * Format a spot / quote price in a fiat currency. USD uses {@link formatUSD}; other codes use locale currency.
 * @param {unknown} value
 * @param {string} [currencyCode]
 * @returns {string}
 */
export function formatFiatPrice (value, currencyCode = 'USD') {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const code =
    (String(currencyCode || 'USD').trim() || 'USD').toUpperCase();
  if (code === 'USD') return formatUSD(n);
  try {
    return n.toLocaleString(locale(), { style: 'currency', currency: code });
  } catch {
    return `${formatLocaleNumber(n)} ${code}`.trim();
  }
}
