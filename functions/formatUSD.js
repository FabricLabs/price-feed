'use strict';

/**
 * USD currency display (US English / USD), used for all fiat amounts when quote currency is USD.
 * @param {unknown} value
 * @returns {string}
 */
export default function formatUSD (value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
