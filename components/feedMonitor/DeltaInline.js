'use strict';

import { formatFiatPrice } from '../localeNumber';
/**
 * Compact delta readout for placement beside the headline spot (arrow + % + vs range).
 *
 * @param {{
 *   delta: { state: string, [k: string]: unknown },
 *   fiat: string
 * }} props
 */
export default function DeltaInline ({ delta, fiat }) {
  if (delta.state === 'ok') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '0.1rem',
          lineHeight: 1.2,
          minWidth: 0
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            flexWrap: 'wrap',
            fontSize: '1.15rem',
            fontWeight: 600
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: '1.05em',
              lineHeight: 1,
              color:
                delta.direction === 'up'
                  ? '#21ba45'
                  : delta.direction === 'down'
                    ? '#db2828'
                    : 'rgba(0,0,0,.45)'
            }}
          >
            {delta.direction === 'up'
              ? '\u25B2'
              : delta.direction === 'down'
                ? '\u25BC'
                : '\u2014'}
          </span>
          <span
            style={{
              color:
                delta.direction === 'up'
                  ? '#1a8752'
                  : delta.direction === 'down'
                    ? '#b21e1e'
                    : 'rgba(0,0,0,.65)'
            }}
          >
            {delta.pct != null && Number.isFinite(delta.pct)
              ? `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(2)}%`
              : '—'}
          </span>
          {delta.abs != null && Number.isFinite(delta.abs) ? (
            <span style={{ fontWeight: 400, opacity: 0.88, fontSize: '0.95rem' }}>
              ({delta.abs > 0 ? '+' : ''}
              {formatFiatPrice(delta.abs, fiat)})
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 400,
            opacity: 0.58
          }}
        >
          vs {delta.baselineLabel}
        </div>
      </div>
    );
  }

  return null;
}
