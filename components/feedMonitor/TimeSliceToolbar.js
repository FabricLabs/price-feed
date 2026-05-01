'use strict';

import {
  Button,
  Dropdown,
  Icon,
  Popup
} from 'semantic-ui-react';

import {
  DELTA_RANGE_OPTIONS,
  DELTA_RANGE_QUICK_KEYS
} from '../Chart';

import { SourceFilterPopoverBody } from './SourceFilterPanel';

/**
 * Chart time-window presets + source filter (sits directly above the chart).
 *
 * @param {{
 *   deltaRangeKey: string,
 *   onSetRange: (key: string) => void,
 *   rangeOpt: { key: string, label: string, ms: number|null },
 *   aggregationMode: string,
 *   onSetAggregationMode: (mode: string) => void,
 *   sourceFilter: null | {
 *     providerIds: string[],
 *     labelById: Map<string, string>,
 *     sourceVisibility: Record<string, boolean>,
 *     onToggle: (id: string) => void,
 *     onSelectAll: () => void,
 *     onSelectNone: () => void
 *   }
 * }} props
 */
export default function TimeSliceToolbar ({
  deltaRangeKey,
  onSetRange,
  rangeOpt,
  aggregationMode,
  onSetAggregationMode,
  sourceFilter
}) {
  const quickOptions = DELTA_RANGE_OPTIONS.filter((o) =>
    DELTA_RANGE_QUICK_KEYS.has(o.key)
  );
  const moreOptions = DELTA_RANGE_OPTIONS.filter(
    (o) => !DELTA_RANGE_QUICK_KEYS.has(o.key)
  );
  const selectionIsExtended = !DELTA_RANGE_QUICK_KEYS.has(deltaRangeKey);

  const sourceTrigger =
    sourceFilter && sourceFilter.providerIds.length > 0 ? (
      <Button
        type="button"
        size="small"
        icon
        labelPosition="left"
        aria-label="Filter contributing sources"
        aria-haspopup="true"
      >
        <Icon name="filter" />
        Sources
      </Button>
    ) : null;

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.45rem',
          width: '100%'
        }}
      >
        <Button.Group size="small" style={{ flexWrap: 'wrap' }} role="presentation">
          {quickOptions.map((opt) => (
            <Button
              key={opt.key}
              type="button"
              toggle
              active={deltaRangeKey === opt.key}
              aria-pressed={deltaRangeKey === opt.key}
              aria-label={`Chart and delta range ${opt.label}`}
              onClick={() => onSetRange(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </Button.Group>

        <Dropdown
          button
          size="small"
          className="icon"
          floating
          icon="clock outline"
          text={selectionIsExtended ? rangeOpt.label : 'More ranges'}
          direction="left"
        >
          <Dropdown.Menu
            style={{
              maxHeight: 'min(260px, 50vh)',
              overflowY: 'auto'
            }}
          >
            {moreOptions.map((opt) => (
              <Dropdown.Item
                key={opt.key}
                active={deltaRangeKey === opt.key}
                onClick={() => onSetRange(opt.key)}
                text={opt.label}
              />
            ))}
          </Dropdown.Menu>
        </Dropdown>

        {sourceTrigger ? (
          <Popup
            wide="very"
            on="click"
            pinned
            position="bottom center"
            closeOnDocumentClick
            trigger={sourceTrigger}
          >
            <SourceFilterPopoverBody {...sourceFilter} />
          </Popup>
        ) : null}

        <Dropdown
          button
          size="small"
          className="icon"
          floating
          icon="options"
          text={`Method: ${aggregationMode}`}
          direction="left"
        >
          <Dropdown.Menu>
            <Dropdown.Item
              active={aggregationMode === 'depth-weighted'}
              onClick={() => onSetAggregationMode('depth-weighted')}
              text="depth-weighted"
            />
            <Dropdown.Item
              active={aggregationMode === 'weighted'}
              onClick={() => onSetAggregationMode('weighted')}
              text="weighted"
            />
            <Dropdown.Item
              active={aggregationMode === 'average'}
              onClick={() => onSetAggregationMode('average')}
              text="average"
            />
          </Dropdown.Menu>
        </Dropdown>
      </div>

      <div
        style={{
          marginTop: '0.35rem',
          fontSize: '0.78rem',
          opacity: 0.55,
          textAlign: 'center',
          width: '100%'
        }}
      >
        Chart window matches <strong>{rangeOpt.label}</strong>
        {rangeOpt.ms == null
          ? ' — all available feed & history (UTC)'
          : ' (UTC)'}
        .
      </div>
    </div>
  );
}
