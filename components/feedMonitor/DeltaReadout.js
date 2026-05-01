'use strict';

import { Message } from 'semantic-ui-react';

/**
 * Extra context below the chart toolbar when the headline Δ has no baseline.
 *
 * @param {{
 *   rangeOpt: { key: string, label: string, ms: number },
 *   delta: { state: string, [k: string]: unknown },
 *   leadUsd: number | undefined
 * }} props
 */
export default function DeltaReadout ({
  rangeOpt,
  delta,
  leadUsd
}) {
  return (
    <div style={{ width: '100%' }}>
      {delta.state === 'nodata' && typeof leadUsd === 'number' && Number.isFinite(leadUsd) ? (
        <Message info size="tiny" style={{ marginTop: '0.85rem' }}>
          Not enough history in this session for <strong>{rangeOpt.label}</strong>
          {' '}— keep the feed running or rely on server{' '}
          <code>priceHistory</code>.
        </Message>
      ) : null}
    </div>
  );
}
