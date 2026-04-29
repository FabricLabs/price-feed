'use strict';

import { useEffect, useRef, useState } from 'react';

import { Button, Dropdown, Icon, Message } from 'semantic-ui-react';

import { formatFiatPrice } from '../localeNumber';
import { resolveBitcoinOracleEstimateUrl } from './utils';

/** Target inter-block time for mapping chart range → block span (mainnet ~10 min). */
export const BTC_TARGET_BLOCK_MS = 600_000;

/** Lowest block height included in the slice for the current chart window (approx.). */
export function utxoSliceMinHeight (tip, rangeMs) {
  if (tip == null || !Number.isFinite(tip)) return 0;
  if (rangeMs == null) return 0;
  const span = Math.max(1, Math.ceil(Number(rangeMs) / BTC_TARGET_BLOCK_MS));
  return Math.max(0, Math.floor(tip) - span);
}

export function utxoDefaultStep (rangeMs) {
  if (rangeMs == null) {
    return 144;
  }
  const span = Math.max(1, Math.ceil(Number(rangeMs) / BTC_TARGET_BLOCK_MS));
  return Math.max(1, Math.floor(span / 12));
}

function positionCount (tip, sliceMin, step) {
  const st = Math.max(1, step);
  return Math.floor((tip - sliceMin) / st) + 1;
}

function positionIndex (tip, focus, step) {
  const st = Math.max(1, step);
  return Math.floor((tip - focus) / st) + 1;
}

const STEP_OPTIONS = [1, 6, 24, 144];

/**
 * Paginate UTXOracle replay along the chain backward from tip, bounded by the active chart time slice.
 *
 * @param {{
 *   feedApiBase: string,
 *   enabled: boolean,
 *   rangeOpt: { key: string, label: string, ms: number|null },
 *   utxoracleChain: null | { tip: number, tipAsOfMs: number }
 * }} props
 */
export default function UtxOracleBlockNavigator ({
  feedApiBase,
  enabled,
  rangeOpt,
  utxoracleChain
}) {
  const rangeKeyRef = useRef(rangeOpt.key);
  const [focusHeight, setFocusHeight] = useState(/** @type {number|null} */ (null));
  const [step, setStep] = useState(() => utxoDefaultStep(rangeOpt.ms));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(/** @type {Record<string, unknown>|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  const tip =
    utxoracleChain != null && Number.isFinite(utxoracleChain.tip)
      ? Math.floor(utxoracleChain.tip)
      : null;
  const sliceMin = tip != null ? utxoSliceMinHeight(tip, rangeOpt.ms) : 0;
  const spanBlocks =
    tip != null ? Math.max(1, tip - sliceMin + 1) : 0;

  useEffect(() => {
    if (tip == null) return;
    const keyChanged = rangeKeyRef.current !== rangeOpt.key;
    rangeKeyRef.current = rangeOpt.key;
    if (keyChanged) {
      setStep(utxoDefaultStep(rangeOpt.ms));
      setFocusHeight(tip);
      return;
    }
    setFocusHeight((h) => {
      const lo = utxoSliceMinHeight(tip, rangeOpt.ms);
      if (h == null) return tip;
      return Math.min(tip, Math.max(lo, h));
    });
  }, [tip, rangeOpt.ms, rangeOpt.key]);

  useEffect(() => {
    if (!enabled || focusHeight == null || !Number.isFinite(focusHeight)) {
      return;
    }
    const ac = new AbortController();
    const requestedHeight = Math.floor(focusHeight);
    (async () => {
      setLoading(true);
      setError(null);
      setResult((prev) => {
        const ph =
          prev != null && typeof prev.height === 'number'
            ? Math.floor(Number(prev.height))
            : null;
        if (ph === requestedHeight) return prev;
        return null;
      });
      try {
        const url = new URL(resolveBitcoinOracleEstimateUrl(feedApiBase));
        url.searchParams.set('height', String(requestedHeight));
        const res = await fetch(url.href, {
          signal: ac.signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          referrerPolicy: 'no-referrer-when-downgrade'
        });
        const body = /** @type {Record<string, unknown>} */ (
          await res.json().catch(() => ({}))
        );
        if (!res.ok) {
          const msg =
            typeof body.error === 'string' && body.error
              ? body.error
              : `${res.status} ${res.statusText}`;
          setError(msg);
          setResult(null);
          return;
        }
        const utxo = body.utxoracle;
        if (
          utxo != null &&
          typeof utxo === 'object' &&
          /** @type {{ error?: unknown }} */ (utxo).error != null &&
          /** @type {{ error?: unknown }} */ (utxo).error !== ''
        ) {
          const err =
            typeof /** @type {{ error?: unknown }} */ (utxo).error === 'string'
              ? /** @type {{ error: string }} */ (utxo).error
              : String(/** @type {{ error?: unknown }} */ (utxo).error);
          setError(err);
          setResult(null);
          return;
        }
        const row =
          utxo != null && typeof utxo === 'object' && 'price' in utxo
            ? /** @type {Record<string, unknown>} */ (utxo)
            : body;
        const price = Number(row.price);
        if (!Number.isFinite(price)) {
          setError('Unexpected response from feed.');
          setResult(null);
          return;
        }
        setResult(row);
      } catch (e) {
        if (/** @type {{ name?: string }} */ (e).name === 'AbortError') return;
        setError(e && e.message ? String(e.message) : String(e));
        setResult(null);
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [focusHeight, feedApiBase, enabled]);

  if (!enabled) {
    return (
      <Message
        size="small"
        info
        style={{
          marginTop: '0.75rem',
          textAlign: 'left',
          width: '100%'
        }}
      >
        Enable UTXOracle on the feed to step through on-chain estimates along the same block span as
        the chart&apos;s <strong>{rangeOpt.label}</strong> window (tip backward).
      </Message>
    );
  }

  if (tip == null) {
    return (
      <Message
        size="small"
        warning
        style={{
          marginTop: '0.75rem',
          width: '100%',
          textAlign: 'left'
        }}
      >
        Chain tip not available yet — wait for the next feed report with a synced node.
      </Message>
    );
  }

  const st = Math.max(1, step);
  const pages = positionCount(tip, sliceMin, st);
  const pageIx =
    focusHeight != null ? positionIndex(tip, focusHeight, st) : 1;
  const canOlder =
    focusHeight != null && Number.isFinite(focusHeight) && focusHeight > sliceMin;
  const canNewer =
    focusHeight != null && Number.isFinite(focusHeight) && focusHeight < tip;
  const navDisabled =
    focusHeight == null || !Number.isFinite(focusHeight) || loading;

  const r = result;

  const stepDropdown = (
    <Dropdown
      selection
      compact
      size="small"
      value={st}
      options={STEP_OPTIONS.map((n) => ({
        key: n,
        text: `±${n} blk`,
        value: n
      }))}
      onChange={(e, { value }) => setStep(Math.max(1, Number(value)))}
      aria-label="Blocks per navigation step"
    />
  );

  return (
    <div
      style={{
        marginTop: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '0.55rem',
        width: '100%'
      }}
    >
      <div
        style={{
          fontSize: '0.78rem',
          opacity: 0.6,
          textAlign: 'center',
          lineHeight: 1.4
        }}
      >
        UTXOracle replay tied to <strong>{rangeOpt.label}</strong> slice · blocks{' '}
        <strong>{sliceMin}</strong>–<strong>{tip}</strong> (~{spanBlocks} high){' '}
        · page <strong>{pageIx}</strong> / <strong>{pages}</strong>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.4rem',
          width: '100%'
        }}
      >
        <Button.Group size="small">
          <Button
            type="button"
            icon
            title="Oldest block in this slice"
            disabled={navDisabled || !canOlder}
            onClick={() => setFocusHeight(sliceMin)}
            aria-label="Jump to oldest block in time slice"
          >
            <Icon name="angle double left" />
          </Button>
          <Button
            type="button"
            icon
            title={`Older by ${st} blocks`}
            disabled={navDisabled || !canOlder}
            onClick={() =>
              setFocusHeight((h) =>
                h == null ? sliceMin : Math.max(sliceMin, h - st)
              )}
            aria-label="Older blocks"
          >
            <Icon name="chevron left" />
          </Button>
          <Button
            type="button"
            icon
            title={`Newer by ${st} blocks`}
            disabled={navDisabled || !canNewer}
            onClick={() =>
              setFocusHeight((h) =>
                h == null ? tip : Math.min(tip, h + st)
              )}
            aria-label="Newer blocks"
          >
            <Icon name="chevron right" />
          </Button>
          <Button
            type="button"
            icon
            title="Current chain tip"
            disabled={navDisabled || !canNewer}
            onClick={() => setFocusHeight(tip)}
            aria-label="Jump to chain tip"
          >
            <Icon name="angle double right" />
          </Button>
        </Button.Group>
        {stepDropdown}
      </div>

      {error ? (
        <Message
          size="small"
          warning
          style={{ width: '100%', textAlign: 'left' }}
        >
          {error}
        </Message>
      ) : null}

      {loading && !r ? (
        <Message size="small" info style={{ width: '100%' }}>
          Computing estimate for block…
        </Message>
      ) : null}

      {r &&
      typeof r.height === 'number' &&
      typeof r.asOfMs === 'number' &&
      !error ? (
        <Message
          size="small"
          positive
          style={{ width: '100%', textAlign: 'left' }}
        >
          <Message.Header style={{ marginBottom: '0.35rem' }}>
            End height {r.height} (synthetic tip) ·{' '}
            <strong>
              {formatFiatPrice(Number(r.price), String(r.currency || 'USD'))}
            </strong>
            {loading ? ' · …' : null}
          </Message.Header>
          <div style={{ fontSize: '0.88rem', opacity: 0.9 }}>
            {typeof r.analyzedThroughHeight === 'number' ? (
              <>
                Last block in estimate <strong>#{r.analyzedThroughHeight}</strong>
                {' — '}
              </>
            ) : null}
            Header time{' '}
            {new Date(Number(r.asOfMs)).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short'
            })}
            {' · '}
            window {String(r.windowBlocks ?? '—')} blocks (UTXOracle)
          </div>
        </Message>
      ) : null}
    </div>
  );
}
