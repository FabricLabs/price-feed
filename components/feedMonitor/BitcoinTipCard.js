'use strict';

import { Header, Segment, Statistic } from 'semantic-ui-react';

import { formatFiatPrice, locale } from '../localeNumber';

/**
 * @param {unknown} n
 * @param {number} [maxFrac]
 */
function formatBtcAmount (n, maxFrac = 3) {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${x.toLocaleString(locale(), { maximumFractionDigits: maxFrac })} BTC`;
}

/**
 * Compact chain tip + stats when UTXOracle / bitcoind backs the feed.
 *
 * @param {{
 *   chain: Record<string, unknown>|null,
 *   utxoSpot?: { price: number, fiat: string, excludedFromSpot?: boolean } | null,
 *   headlineSpotUsd?: number | null,
 *   fiat?: string
 * }} props
 */
export default function BitcoinTipCard ({
  chain,
  utxoSpot,
  headlineSpotUsd,
  fiat
}) {
  if (!chain || !Number.isFinite(Number(chain.tip))) {
    return null;
  }

  const tip = Math.floor(Number(chain.tip));
  const tipMs = Number(chain.tipAsOfMs);
  const hdrs = Number(chain.headers);
  const vp = chain.verificationProgress;
  const pruned = chain.pruned === true;
  const ibd = chain.initialBlockDownload === true;

  /** Mirrors server gating: UTXOracle omitted from weighted spot until caught up + verified. */
  const utxoExcludedFromHeadline =
    ibd ||
    (vp != null && Number.isFinite(vp) && vp < 0.999999) ||
    (Number.isFinite(hdrs) && hdrs > tip);

  const tipTime =
    Number.isFinite(tipMs) && tipMs > 0
      ? new Date(tipMs).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : '—';

  const spot = utxoSpot;
  const showSpot =
    spot &&
    typeof spot.price === 'number' &&
    Number.isFinite(spot.price) &&
    typeof spot.fiat === 'string' &&
    spot.fiat.trim() !== '';

  const fiatCode =
    typeof fiat === 'string' && fiat.trim() !== ''
      ? fiat.trim().toUpperCase()
      : showSpot
        ? spot.fiat.trim().toUpperCase()
        : 'USD';

  const spotPx =
    showSpot && Number.isFinite(spot.price)
      ? spot.price
      : headlineSpotUsd != null && Number.isFinite(headlineSpotUsd)
        ? headlineSpotUsd
        : null;

  const supplyBtc = Number(chain.circulatingSupplyBtc);
  const hasSupply = Number.isFinite(supplyBtc) && supplyBtc > 0;

  const tipOutBtc = Number(chain.tipBlockOutputBtc);
  const hasTipOut = Number.isFinite(tipOutBtc) && tipOutBtc >= 0;
  const tipOutFiat =
    hasTipOut && spotPx != null && Number.isFinite(spotPx * tipOutBtc)
      ? spotPx * tipOutBtc
      : null;

  const syncLabel =
    vp != null && Number.isFinite(vp) && vp < 0.999
      ? `${(vp * 100).toFixed(2)} % verified`
      : null;

  return (
    <Segment secondary size="small" style={{ marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem 1.5rem',
          justifyContent: 'space-between',
          alignItems: 'flex-start'
        }}
      >
        <Statistic size="mini">
          <Statistic.Value>{tip.toLocaleString()}</Statistic.Value>
          <Statistic.Label>Height</Statistic.Label>
        </Statistic>
        <Statistic size="mini">
          <Statistic.Value>
            {hasSupply ? formatBtcAmount(supplyBtc, 2) : '—'}
          </Statistic.Value>
          <Statistic.Label>Supply</Statistic.Label>
        </Statistic>
        <Statistic size="mini">
          <Statistic.Value>
            {tipOutFiat != null
              ? formatFiatPrice(tipOutFiat, fiatCode)
              : hasTipOut
                ? formatBtcAmount(tipOutBtc, 2)
                : '—'}
          </Statistic.Value>
          <Statistic.Label>Tip block output value</Statistic.Label>
          {tipOutFiat != null && hasTipOut ? (
            <div
              style={{
                marginTop: '0.2rem',
                fontSize: '0.74rem',
                fontWeight: 500,
                opacity: 0.58
              }}
            >
              {formatBtcAmount(tipOutBtc, 2)}{' '}
              <span style={{ fontWeight: 400 }}>× spot</span>
            </div>
          ) : null}
        </Statistic>
        {showSpot ? (
          <Statistic size="small">
            <Statistic.Value>
              {formatFiatPrice(spot.price, spot.fiat)}
            </Statistic.Value>
            <Statistic.Label>
              UTXOracle estimate
              {spot.excludedFromSpot ? ' · not in headline blend' : ''}
            </Statistic.Label>
          </Statistic>
        ) : null}
      </div>
      <div
        style={{
          marginTop: '0.65rem',
          fontSize: '0.82rem',
          opacity: 0.62,
          lineHeight: 1.45
        }}
      >
        {syncLabel ? <span>{syncLabel} · </span> : null}
        {utxoExcludedFromHeadline ? (
          <span>
            UTXOracle is <strong>excluded</strong> from the headline weighted price until the node is
            fully synced and verified.{' '}
          </span>
        ) : null}
        {pruned ? <span>Pruned node · </span> : null}
        <span>
          <strong>Supply</strong> is circulating BTC from the node’s UTXO set (refreshed at most once
          per hour). <strong>Tip block output value</strong> is the sum of all outputs in the tip block;
          fiat uses the UTXOracle estimate when available, otherwise the headline spot.{' '}
        </span>
        <span>
          UTXOracle quotes use the header time of the <strong>highest block included</strong> in each
          estimate (tip <code>− 1</code> for a synced node).
        </span>
      </div>
    </Segment>
  );
}
