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
            <Table.HeaderCell>Active</Table.HeaderCell>
            <Table.HeaderCell>Fabric service</Table.HeaderCell>
            <Table.HeaderCell>Last success</Table.HeaderCell>
            <Table.HeaderCell>Next update</Table.HeaderCell>
            <Table.HeaderCell>BTC quote</Table.HeaderCell>
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
            const svc = row.service && typeof row.service === 'object' ? row.service : null;
            const svcTxt =
              svc && svc.status != null
                ? `${String(svc.status)}${svc.id ? ` · ${String(svc.id).slice(0, 8)}…` : ''}`
                : '—';
            const err =
              row.lastError != null && String(row.lastError).trim() !== ''
                ? String(row.lastError)
                : '—';
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
                  {row.enabled ? 'yes' : 'no'}
                </Table.Cell>
                <Table.Cell
                  style={{
                    fontSize: '0.9em',
                    wordBreak: 'break-word'
                  }}
                >
                  {svcTxt}
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
