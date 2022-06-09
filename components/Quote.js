/**
 * Live price feed component.
 */

// Dependencies
import React, {
  Component
} from 'react';

// Fomantic
import {
  Segment,
  Table
} from 'semantic-ui-react';

// Styles
const label = {
  textAlign: 'right'
};

// Define our component
export default class Quote extends Component {
  constructor (props = {}) {
    super(props);

    this.settings = Object.assign({
      frequency: 0.007
    }, this.state, props);

    this.state = this.props;

    this._state = {
      content: Object.assign({
        age: 0,
        created: (new Date()).toISOString(),
        currency: 'USD',
        rate: 29349.54,
        symbol: 'BTC'
      }, this.state) // TODO: inherit get state () from Actor
    };

    return this;
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
      self._state.content.age = Date.now() - Date.parse(this.state.created);
      self.setState(self._state.content);
    }, self.settings.frequency);
  }

  withLocale (value) {
    if (typeof value !== 'Number') value = parseFloat(value);
    return value.toLocaleString(this.locale);
  }

  render () {
    return (
      <>
        <portal-feed-quote>
          <Segment compact>
            <Table>
              <Table.Header></Table.Header>
              <Table.Body>
                <Table.Row>
                  <Table.Cell style={label}>
                    <strong htmlFor="symbol">Symbol:</strong>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="symbol">{this.state.symbol}</code>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell style={label}>
                    <strong htmlFor="currency">Currency:</strong>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="currency">{this.state.currency}</code>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell style={label}>
                    <strong htmlFor="rate">Rate:</strong>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="rate">{this.state.rate.toFixed(2)}</code>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell style={label}>
                    <strong htmlFor="symbol">Age:</strong>
                  </Table.Cell>
                  <Table.Cell>
                    <abbr data-bind="age" title={this.state.created}>{this.state.age} ms</abbr>
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table>
          </Segment>
        </portal-feed-quote>
      </>
    );
  }
};
