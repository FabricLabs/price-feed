'use strict';

import { List } from 'semantic-ui-react';

import { formatFiatPrice } from '../localeNumber';
import TlsQuoteTrust from './TlsQuoteTrust';
import { isSourceVisible, lookupProviderTls } from './utils';

const PROVIDER_BUY_URLS = Object.freeze({
  coinbase: 'https://www.coinbase.com/join',
  kraken: 'https://www.kraken.com/features/affiliate-program',
  bitstamp: 'https://www.bitstamp.net/referral-program/',
  gemini: 'https://www.gemini.com/refer-a-friend',
  bitfinex: 'https://www.bitfinex.com/referral',
  binance: 'https://accounts.binance.com/en/register',
  binanceus: 'https://www.binance.us/register',
  okx: 'https://www.okx.com/join',
  bybit: 'https://www.bybit.com/invite',
  kucoin: 'https://www.kucoin.com/r/af',
  gateio: 'https://www.gate.io/signup',
  mexc: 'https://www.mexc.com/register',
  bitget: 'https://www.bitget.com/en/referral/register',
  htx: 'https://www.htx.com/invite/en-us/',
  coinex: 'https://www.coinex.com/register',
  cexio: 'https://cex.io/r/0/up100',
  upbit: 'https://id.upbit.com/signup',
  bitso: 'https://bitso.com/register',
  phemex: 'https://phemex.com/register',
  bitvavo: 'https://bitvavo.com/en/register',
  cryptocom: 'https://crypto.com/exchange/register',
  whitebit: 'https://whitebit.com/auth/register',
  lbank: 'https://www.lbank.com/login',
  digifinex: 'https://www.digifinex.com/en-ww/register',
  ascendex: 'https://ascendex.com/en/register',
  btse: 'https://www.btse.com/en/referral',
  bitmart: 'https://www.bitmart.com/register',
  bingx: 'https://bingx.com/en-us/invite',
  bitrue: 'https://www.bitrue.com/user/register',
  poloniex: 'https://poloniex.com/signup',
  deribit: 'https://www.deribit.com/accounts/signup'
});

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
 *   tlsByProvider?: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>>,
 *   aggregationMode?: string,
 *   compact?: boolean
 * }} props
 */
export default function HeadlineSourceQuotes ({
  quote,
  sourceVisibility,
  labelById,
  fiat,
  onOpenInspect,
  tlsByProvider,
  aggregationMode = 'weighted',
  compact = false
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
      const depthCapable = Number.isFinite(Number(s?.depth)) && Number(s.depth) > 0;
      return {
        providerId: provider,
        key: provider + ':' + String(price) + ':' + String(excluded),
        name,
        price,
        nameLower: name.toLowerCase(),
        buyUrl: PROVIDER_BUY_URLS[provider] || null,
        excluded,
        depthCapable
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const byPrice = a.price - b.price;
      if (byPrice !== 0) return byPrice;
      return a.nameLower.localeCompare(b.nameLower);
    });

  if (!rows.length) return null;

  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.35rem 0.5rem'
        }}
      >
        <span
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            opacity: 0.52
          }}
        >
          By source · {fiat}
        </span>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            style={{
              border: '1px solid rgba(0,0,0,.12)',
              background: '#fff',
              borderRadius: '999px',
              padding: '0.18rem 0.55rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              cursor: 'pointer'
            }}
            onClick={() => onOpenInspect(quote)}
          >
            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
              {row.name}
            </span>
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                opacity: 0.92
              }}
            >
              {formatFiatPrice(row.price, fiat)}
            </span>
            {row.depthCapable ? (
              <span
                title="Depth-capable source"
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  opacity: 0.64
                }}
              >
                Depth
              </span>
            ) : null}
            {row.buyUrl ? (
              <a
                href={row.buyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em'
                }}
              >
                Buy
              </a>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  opacity: 0.92
                }}
              >
                <span>{formatFiatPrice(row.price, fiat)}</span>
                {row.depthCapable ? (
                  <span
                    title="Depth-capable source"
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      opacity: 0.64
                    }}
                  >
                    Depth
                  </span>
                ) : null}
                {row.buyUrl ? (
                  <a
                    href={row.buyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em'
                    }}
                  >
                    Buy
                  </a>
                ) : null}
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
                Not included in headline {aggregationMode} blend (sync / verification)
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
