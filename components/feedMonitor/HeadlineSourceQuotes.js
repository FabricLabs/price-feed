'use strict';

import { List } from 'semantic-ui-react';

import { formatFiatPrice } from '../localeNumber';
import TlsQuoteTrust from './TlsQuoteTrust';
import { isSourceVisible, lookupProviderTls } from './utils';

/**
 * Right column beside headline: each contributor’s price from the latest quote (opens full breakdown).
 *
 * @param {{
 *   quote: {
 *     created?: string,
 *     rate?: number,
 *     sources?: { label?: string, provider?: string, price?: unknown }[],
 *     sourceCount?: number,
 *     symbol?: string,
 *     currency?: string
 *   },
 *   sourceVisibility: Record<string, boolean>,
 *   labelById: Map<string, string>,
 *   fiat: string,
 *   onOpenInspect: (q: object) => void,
 *   tlsByProvider?: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>>
 * }} props
 */
export default function HeadlineSourceQuotes ({
  quote,
  sourceVisibility,
  labelById,
  fiat,
  onOpenInspect,
  tlsByProvider
}) {
  const src = Array.isArray(quote?.sources) ? quote.sources : [];
  const rows = src
    .map((s, i) => {
      const provider =
        s && s.provider != null ? String(s.provider) : `idx:${i}`;
      if (!isSourceVisible(provider, sourceVisibility)) return null;
      const price = Number(s?.price);
      if (!Number.isFinite(price)) return null;
      const name =
        (s && String(s.label || '').trim()) ||
        labelById.get(provider) ||
        provider;
      const excluded =
        /** @type {{ excludedFromSpot?: boolean }} */ (s).excludedFromSpot ===
        true;
      return {
        providerId: provider,
        key: provider + ':' + String(price) + ':' + String(excluded),
        name,
        price,
        nameLower: name.toLowerCase(),
        excluded
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.nameLower.localeCompare(b.nameLower));

  if (!rows.length) return null;

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 600,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          opacity: 0.5,
          marginBottom: '0.45rem'
        }}
      >
        By source · {fiat}
      </div>
      <List
        selection
        verticalAlign="middle"
        style={{ margin: 0 }}
      >
        {rows.map((row) => (
          <List.Item
            key={row.key}
            role="button"
            tabIndex={0}
            style={{
              borderRadius: '4px',
              padding: '0.45rem 0.5rem !important',
              margin: '0 0 0.25rem 0 !important',
              border: '1px solid rgba(0,0,0,.08)'
            }}
            onClick={() => onOpenInspect(quote)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onOpenInspect(quote);
            }}
          >
            <List.Content
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '0.65rem',
                flexWrap: 'wrap'
              }}
            >
              <List.Header
                as="span"
                style={{
                  fontWeight: 600,
                  fontSize: '0.92rem',
                  margin: 0
                }}
              >
                {row.name}
              </List.Header>
              <span
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  opacity: 0.92
                }}
              >
                {formatFiatPrice(row.price, fiat)}
              </span>
            </List.Content>
            {tlsByProvider ? (
              <div
                style={{
                  marginTop: '0.28rem',
                  maxWidth: '100%',
                  overflow: 'hidden'
                }}
              >
                <TlsQuoteTrust
                  tls={lookupProviderTls(tlsByProvider, row.providerId)}
                  compact
                />
              </div>
            ) : null}
            {row.excluded ? (
              <div
                style={{
                  marginTop: '0.2rem',
                  fontSize: '0.72rem',
                  opacity: 0.52,
                  lineHeight: 1.35
                }}
              >
                Not included in headline weighted blend (sync / verification)
              </div>
            ) : null}
          </List.Item>
        ))}
      </List>
      <div
        style={{
          marginTop: '0.35rem',
          fontSize: '0.72rem',
          opacity: 0.5
        }}
      >
        Tap a row for contributor detail
      </div>
    </div>
  );
}
