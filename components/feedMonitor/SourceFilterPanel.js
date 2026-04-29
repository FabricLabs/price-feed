'use strict';

import {
  Button,
  Checkbox,
  Form,
  Header
} from 'semantic-ui-react';

/**
 * Compact source checkboxes for use inside a Semantic UI Popup (see TimeSliceToolbar).
 *
 * @param {{
 *   providerIds: string[],
 *   labelById: Map<string, string>,
 *   sourceVisibility: Record<string, boolean>,
 *   onToggle: (id: string) => void,
 *   onSelectAll: () => void,
 *   onSelectNone: () => void
 * }} props
 */
export function SourceFilterPopoverBody ({
  providerIds,
  labelById,
  sourceVisibility,
  onToggle,
  onSelectAll,
  onSelectNone
}) {
  if (!providerIds.length) return null;

  return (
    <div style={{ minWidth: '260px', maxWidth: 'min(400px, 92vw)' }}>
      <Header as="h5" style={{ margin: '0 0 0.55rem' }}>
        Filter by source
      </Header>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
          marginBottom: '0.55rem'
        }}
      >
        <Button.Group size="small">
          <Button type="button" onClick={onSelectAll}>
            All
          </Button>
          <Button type="button" onClick={onSelectNone}>
            None
          </Button>
        </Button.Group>
      </div>
      <Form>
        <Form.Group grouped style={{ marginBottom: 0 }}>
          {providerIds.map((id) => (
            <Form.Field
              key={id}
              control={Checkbox}
              label={labelById.get(id) || id}
              checked={sourceVisibility[id] !== false}
              onChange={() => onToggle(id)}
            />
          ))}
        </Form.Group>
      </Form>
      <p
        style={{
          margin: '0.65rem 0 0',
          fontSize: '0.78rem',
          opacity: 0.55
        }}
      >
        Headline, chart, delta, and recent rows use only checked sources (same inverse-age
        weights as the server).
      </p>
    </div>
  );
}
