/**
 * Live price feed component.
 */

import React, { Component } from 'react';
import {
  Label,
  Segment
} from 'semantic-ui-react';

export default class Rate extends Component {
  state = {
    value: 29349.54,
    currency: 'USD',
    symbol: 'BTC'
  };

  constructor (props = {}) {
    super(props);

    this.settings = Object.assign({}, this.state, props);
    this._state = {
      content: this.state
    };
  }

  get locale () {
    return Intl.NumberFormat().resolvedOptions().locale;
  }

  get price () {
    return this.state.value;
  }

  withLocale (value) {
    let n = value;
    if (typeof n !== 'number') n = parseFloat(String(value));
    return typeof n === 'number' && !Number.isNaN(n)
      ? n.toLocaleString(this.locale)
      : '';
  }

  render () {
    return (
      <portal-feed-rate>
        <Segment compact>
          <Label htmlFor="rate-price-label">{this.state.currency}</Label>
          <code
            id="rate-price-label"
            data-bind="price"
            style={{ display: 'inline-block', marginLeft: '1em' }}
          >
            {this.withLocale(this.state.value)}
          </code>
        </Segment>
      </portal-feed-rate>
    );
  }
}
