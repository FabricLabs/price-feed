'use strict';

import { Header, Message, Segment } from 'semantic-ui-react';

import Quote from '../Quote';

/**
 * @param {{
 *   quoteView: unknown[],
 *   totalQuotes: number,
 *   onOpenInspect: (quote: object) => void
 * }} props
 */
export default function RecentQuotesList ({ quoteView, totalQuotes, onOpenInspect }) {
  return (
    <>
      <Header dividing size="small">
        Recent quotes
      </Header>
      <Segment.Group style={{ width: '100%' }}>
        {quoteView.map((quote, i) => {
          const q = /** @type {{
            created?: string,
            rate?: number,
            sources?: unknown[],
            sourceCount?: number,
            symbol?: string,
            currency?: string
          }} */ (quote);
          const id = totalQuotes - i;
          const hasProv = Array.isArray(q.sources) && q.sources.length > 0;

          return (
            <Segment
              key={`${q.created}-${id}`}
              style={{
                width: '100%',
                ...(hasProv ? { cursor: 'pointer', outline: 'none' } : {})
              }}
              {...(hasProv ? {
                tabIndex: 0,
                role: 'button',
                onClick: () => onOpenInspect(q),
                onKeyDown: (e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onOpenInspect(q);
                }
              } : {})}
            >
              <Header as="h5" style={{ marginBottom: '0.35rem' }}>
                {`Quote #${id}`}
              </Header>
              {hasProv ? (
                <div
                  style={{
                    fontSize: '0.82em',
                    color: 'rgba(0,0,0,.55)',
                    marginBottom: '0.5rem'
                  }}
                >
                  Tap to explore sources
                </div>
              ) : null}
              <Quote
                rate={q.rate}
                sources={q.sources}
                sourceCount={q.sourceCount}
                symbol={q.symbol}
                currency={q.currency}
                created={q.created}
                compactSourceList
              />
            </Segment>
          );
        })}
      </Segment.Group>
      {totalQuotes > quoteView.length ? (
        <Message size="small" style={{ marginTop: '0.75rem' }}>
          Showing {quoteView.length} of {totalQuotes} quotes (newest first).
        </Message>
      ) : null}
    </>
  );
}
