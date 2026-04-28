/**
 * Live price feed component.
 */

import React, {
  Component
} from 'react';

import {
  Segment,
  Table
} from 'semantic-ui-react';

const label = {
  textAlign: 'right'
};

export default class Quote extends Component {
  constructor (props = {}) {
    super(props);

    this.state = { ...props };

    this.settings = Object.assign({
      frequency: 0.007
    }, this.state);

    this._state = {
      content: Object.assign({
        age: 0,
        created: (new Date()).toISOString(),
        currency: 'USD',
        rate: 29349.54,
        symbol: 'BTC'
      }, this.state)
    };
  }

  get locale () {
    return Intl.NumberFormat().resolvedOptions().locale;
  }

  get rate () {
    return this.state.value;
  }

  componentDidMount () {
    const self = this;
    self._timekeeper = setInterval(() => {
      self._state.content.age = Date.now() - Date.parse(this.state.created ?? self._state.content.created);
      self.setState(self._state.content);
    }, self.settings.frequency);
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
      <portal-feed-quote>
        <Segment compact>
          <Table>
            <Table.Header />
            <Table.Body>
              <Table.Row>
                <Table.Cell style={label}>
                  <label htmlFor="quote-symbol-id"><strong>Symbol:</strong></label>
                </Table.Cell>
                <Table.Cell>
                  <code id="quote-symbol-id" data-bind="symbol">{this.state.symbol}</code>
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell style={label}>
                  <label htmlFor="quote-currency-id"><strong>Currency:</strong></label>
                </Table.Cell>
                <Table.Cell>
                  <code id="quote-currency-id" data-bind="currency">{this.state.currency}</code>
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell style={label}>
                  <label htmlFor="quote-rate-id"><strong>Rate:</strong></label>
                </Table.Cell>
                <Table.Cell>
                  <code id="quote-rate-id" data-bind="rate">{this.state.rate.toFixed(2)}</code>
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell style={label}>
                  <label htmlFor="quote-age-id"><strong>Age:</strong></label>
                </Table.Cell>
                <Table.Cell>
                  <abbr id="quote-age-id" data-bind="age" title={this.state.created}>{this.state.age} ms</abbr>
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table>
        </Segment>
      </portal-feed-quote>
    );
  }
}
