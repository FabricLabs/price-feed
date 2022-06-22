const LIMIT_PER_PAGE = 3;

import * as React from 'react';
import '../styles/feed.css';
// import '../libraries/fomantic/dist/fomantic.css';

import {
  Button,
  Card,
  Header,
  Segment
} from 'fomantic-ui-react';

// import d3 from 'd3';
import * as Plot from '@observablehq/plot';

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
        created: (new Date()).toISOString(),
        rate: 29349.54,
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

    this.ref = React.createRef();
    this.chart = React.createRef();

    return this;
  }

  componentDidMount () {
    const self = this;

    self._monitor = setInterval(async () => {
      const _GET = async function _GET (path) {
        const delta = (((Math.random() < 0.5) ? 1 : -1) * Math.random());

        switch (path) {
          default:
            return {
              quotes: self.state.quotes
            };
          case '/quotes':
            return self.state.quotes.concat({
              created: (new Date()).toISOString(),
              delta: delta,
              rate: self.state.quotes[ self.state.quotes.length - 1 ].rate + delta,
              currency: 'USD',
              symbol: 'BTC'
            });
        }
      }

      const simulator = { _GET };

      const remote = simulator; // new Remote({ authority: 'localhost:3000' });
      const result = await remote._GET('/quotes');
      self._state.content.quotes = result;
      self.setState(self._state.content);
    }, 2500);
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
    const quotes = [].concat(this.state.quotes).sort((a, b) => {
      return (Date.parse(a.created) > Date.parse(b.created)) ? -1 : 1;
    });

    const quoteView = quotes.slice(0, LIMIT_PER_PAGE);
    const outOfBounds = quotes.length - quoteView.length;

    const chart = Plot.line(quotes.map(x => {
      return {
        ...x,
        created: new Date(x.created)
      };
    }), {
      x: 'created',
      y: 'rate'
    }).plot({
      marginBottom: 50,
      marginLeft: 75,
      width: (this.chart.current) ? this.chart.current.offsetWidth : 600,
      x: { tickRotate: 45 }
    });

    return (
      <fabric-content-page className="ui page" ref={this.ref}>
        <Segment>
          <Header><h1>Price</h1></Header>
          <Feed />

          <Header><h2>Symbols</h2></Header>
          <div className="ui cards">
            {this.state.symbols.map((symbol, i) => {
              return (
                <Card key={i}>
                  <Card.Content>
                    <Header>{symbol}</Header>
                    <Rate currency={this.state.currency} symbol={symbol} />
                  </Card.Content>
                </Card>
              );
            })}
          </div>

          <Header><h2>Quotes</h2></Header>
          <Segment ref={this.chart} class="chart" dangerouslySetInnerHTML={{ __html: chart.outerHTML }}></Segment>
          <div className="ui cards">
            {quoteView.map((quote, i) => {
              const id = quotes.length - i;
              return (
                <Card key={id}>
                  <Card.Content>
                    <Header><strong>Quote #{id}</strong></Header>
                    <Quote symbol={quote.symbol} currency={quote.currency} rate={quote.rate} />
                  </Card.Content>
                </Card>
              );
            })}
            {(outOfBounds) ? <Card>
              <Card.Content>
                <Button>{outOfBounds} more</Button>
              </Card.Content>
            </Card> : undefined}
          </div>
        </Segment>
        {/* <FabricBridge host="localhost" secure="false" port="3000" /> */}
      </fabric-content-page>
    );
  }
}
