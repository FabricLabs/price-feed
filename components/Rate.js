/**
 * Compact numeric rate + label.
 */

'use strict';

import { Component } from 'react';

import {
  Statistic
} from 'semantic-ui-react';

import { formatLocaleNumber } from './localeNumber';

export default class Rate extends Component {
  render () {
    const v = this.props.value;
    const show = typeof v === 'number' && Number.isFinite(v);

    return (
      <Statistic size="tiny">
        <Statistic.Value>
          {show ? formatLocaleNumber(v, { empty: '—' }) : '—'}
        </Statistic.Value>
        <Statistic.Label>
          {this.props.currency}
          {typeof this.props.sourceCount === 'number' &&
          Number.isFinite(this.props.sourceCount) ? (
            <span style={{ display: 'block', fontSize: '0.85em', marginTop: '0.35em' }}>
              {this.props.sourceCount} source{this.props.sourceCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </Statistic.Label>
      </Statistic>
    );
  }
}
