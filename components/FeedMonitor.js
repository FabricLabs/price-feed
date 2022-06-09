import React from 'react';
import '../styles/feed.css';
// import '../libraries/fomantic/dist/semantic.css';

import {
  Card,
  Header,
  Segment
} from 'semantic-ui-react';

// Internal Components
import Feed from './Feed';
import Quote from './Quote';
import Rate from './Rate';

export default class FeedMonitor extends React.Component {
  state = {
    currency: 'USD',
    symbols: ['BTC', 'NMC', 'LTC'],
    quotes: [
      {
        value: 29349.54,
        currency: 'USD',
        symbol: 'BTC'
      }
    ]
  }

  constructor (props = {}) {
    super(props);

    this._state = {
      assets: {},
      content: this.state // TODO: inherit get state () from Actor
    };

    return this;
  }

  trust (source) {
    source.on('log', this._handleSourceLog.bind(this));
  }

  _handleBridgeReady (info) {
    console.log('[FEED] Bridge Reported Ready:', info);
  }

  _handleSourceLog (log) {
    this.emit('log', `Source log: ${log}`);
  }

  render () {
    return (
      <fabric-content-page class="ui page">
        <Segment>
          <Header><h1>Price</h1></Header>
          <Feed />

          <Header><h2>Symbols</h2></Header>
          <div class="ui cards">
            {this.state.symbols.map((symbol) => {
              return (
                <Card>
                  <Card.Content>
                    <Header>{symbol}</Header>
                    <Rate currency={this.state.currency} symbol={symbol} />
                  </Card.Content>
                </Card>
              );
            })}
          </div>

          <Header><h2>Quotes</h2></Header>
          <div class="ui cards">
            {this.state.quotes.map((quote, i) => {
              return (
                <Card>
                  <Card.Content>
                    <Header><strong>Quote #{i + 1} (quotes[{i}])</strong></Header>
                    <Quote symbol={quote.symbol} currency={quote.currency} price={quote.price} />
                  </Card.Content>
                </Card>
              );
            })}
          </div>
        </Segment>
        {/* <FabricBridge host="localhost" secure="false" port="3000" /> */}
      </fabric-content-page>
    );
  }
}
