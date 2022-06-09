/**
 * Live price feed component.
 */

// Dependencies
import React, { Component } from 'react';
import {
  Label,
  Segment
} from 'semantic-ui-react';

// Define our component
export default class Rate extends Component {
  state = {
    value: 29349.54,
    currency: 'USD',
    symbol: 'BTC'
  }

  constructor (props = {}) {
    super(props);

    this.settings = Object.assign({}, this.state, props);
    this._state = {
      content: this.state // TODO: inherit get state () from Actor
    };

    return this;
  }

  get locale () {
    return Intl.NumberFormat().resolvedOptions().locale;
  }

  get price () {
    return this.state.value;
  }

  withLocale (value) {
    if (typeof value !== 'Number') value = parseFloat(value);
    return value.toLocaleString(this.locale);
  }

  render () {
    return (
      <>
        <portal-feed-rate>
          <Segment compact>
            <Label for="currency">{this.state.currency}</Label>
            <code data-bind="price" style={{ display: 'inline-block', marginLeft: '1em' }}>{this.withLocale(this.state.value)}</code>
          </Segment>
        </portal-feed-rate>
      </>
    );
  }
};
