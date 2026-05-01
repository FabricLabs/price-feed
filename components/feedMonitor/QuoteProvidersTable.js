'use strict';

import { Message, Table } from 'semantic-ui-react';

import TlsQuoteTrust from './TlsQuoteTrust';

import {
  formatNextFetch,
  formatProviderQuotesLine,
  formatProviderTs
} from './utils';

/**
 * @param {{ providers: unknown[] }} props
 */
export default function QuoteProvidersTable ({ providers }) {
  if (!providers.length) {
    return (
      <Message info size="small">
        Provider status will appear here once the feed report includes{' '}
        <code>quoteProviders</code>.
      </Message>
    );
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <Table celled compact unstackable>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Provider</Table.HeaderCell>
            <Table.HeaderCell>Last success</Table.HeaderCell>
            <Table.HeaderCell>Next update</Table.HeaderCell>
            <Table.HeaderCell>BTC quote</Table.HeaderCell>
            <Table.HeaderCell>Depth</Table.HeaderCell>
            <Table.HeaderCell>TLS (last request)</Table.HeaderCell>
            <Table.HeaderCell>Last error</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {providers.map((p) => {
            const row = /** @type {{
              id?: string,
              label?: string,
              enabled?: boolean,
              service?: Record<string, unknown> | null,
              resource?: { key?: string },
              lastSuccessAt?: number,
              nextFetchAt?: number,
              quotesBySymbol?: Record<string, unknown>,
              lastError?: unknown,
              lastTls?: Record<string, unknown> | null
            }} */ (p);
            const err =
              row.lastError != null && String(row.lastError).trim() !== ''
                ? String(row.lastError)
                : '—';
            const btcQuote = row.quotesBySymbol && typeof row.quotesBySymbol === 'object'
              ? row.quotesBySymbol.BTC
              : null;
            const btcDepth = Number(
              btcQuote && typeof btcQuote === 'object' ? btcQuote.depth : NaN
            );
            const depthCapable = Number.isFinite(btcDepth) && btcDepth > 0;
            return (
              <Table.Row key={String(row.id || row.label)}>
                <Table.Cell>
                  <strong>{String(row.label || row.id || '')}</strong>
                  <div
                    style={{
                      fontSize: '0.78em',
                      color: 'rgba(0,0,0,.52)',
                      marginTop: '0.25rem'
                    }}
                  >
                    {row.resource && row.resource.key
                      ? `resource: ${String(row.resource.key)}`
                      : ''}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  {formatProviderTs(row.lastSuccessAt)}
                </Table.Cell>
                <Table.Cell
                  title={
                    typeof row.nextFetchAt === 'number' &&
                    Number.isFinite(row.nextFetchAt) &&
                    row.nextFetchAt > Date.now()
                      ? new Date(row.nextFetchAt).toISOString()
                      : undefined
                  }
                >
                  {formatNextFetch(row.nextFetchAt, !!row.enabled)}
                </Table.Cell>
                <Table.Cell
                  style={{
                    fontSize: '0.88em',
                    wordBreak: 'break-word'
                  }}
                >
                  {formatProviderQuotesLine(row.quotesBySymbol)}
                </Table.Cell>
                <Table.Cell
                  style={{
                    fontSize: '0.82em',
                    wordBreak: 'break-word'
                  }}
                >
                  {depthCapable ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}
                    >
                      <strong>Yes</strong>
                      <span style={{ opacity: 0.62 }}>
                        {Math.round(btcDepth).toLocaleString()}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )}
                </Table.Cell>
                <Table.Cell
                  style={{
                    fontSize: '0.82em',
                    wordBreak: 'break-word'
                  }}
                >
                  <TlsQuoteTrust tls={row.lastTls} />
                </Table.Cell>
                <Table.Cell
                  style={{
                    fontSize: '0.88em',
                    color: err !== '—' ? '#9f3a38' : undefined,
                    wordBreak: 'break-word'
                  }}
                >
                  {err}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </div>
  );
}
