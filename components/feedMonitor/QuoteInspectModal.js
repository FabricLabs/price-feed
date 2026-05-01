'use strict';

import { Button, Modal } from 'semantic-ui-react';

import Quote from '../Quote';

/**
 * @param {{
 *   open: boolean,
 *   quote: import('react').ComponentProps<typeof Quote> | null,
 *   onClose: () => void,
 *   tlsByProvider?: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>>
 * }} props
 */
export default function QuoteInspectModal ({ open, quote, onClose, tlsByProvider }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="small"
      closeIcon={false}
      closeOnDimmerClick
      closeOnEscape
    >
      <Modal.Header>
        {quote
          ? `Sources — ${quote.symbol}`
          : ''}
      </Modal.Header>
      <Modal.Content scrolling>
        {quote ? (
          <Quote
            rate={quote.rate}
            sources={quote.sources}
            sourceCount={quote.sourceCount}
            symbol={quote.symbol}
            currency={quote.currency}
            created={quote.created}
            showAllSources
            tlsByProvider={tlsByProvider}
          />
        ) : null}
      </Modal.Content>
      <Modal.Actions>
        <Button
          type="button"
          primary
          onClick={onClose}
        >
          Close
        </Button>
      </Modal.Actions>
    </Modal>
  );
}
