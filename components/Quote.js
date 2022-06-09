/**
 * Live price feed component.
 */

// Dependencies
import React, { Component } from 'react';
import {
  Label,
  Segment,
  Table
} from 'semantic-ui-react';

// Define our component
export default class Quote extends Component {
  state = {
    age: 0,
    created: (new Date()).toISOString(),
    currency: 'USD',
    price: 29349.54,
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
        <portal-feed-quote>
          <Segment compact>
            <Table>
              <Table.Header></Table.Header>
              <Table.Body>
                <Table.Row>
                  <Table.Cell>
                    <Label for="symbol">Symbol:</Label>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="symbol">{this.state.symbol}</code>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>
                    <Label for="currency">Currency:</Label>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="currency">{this.state.currency}</code>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>
                    <Label for="price">Price:</Label>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="price">{this.state.price}</code>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>
                    <Label for="symbol">Age:</Label>
                  </Table.Cell>
                  <Table.Cell>
                    <code data-bind="age" title={this.state.created}>{this.state.age}</code>
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
