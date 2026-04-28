const LIMIT_PER_PAGE = 3;

import React from 'react';
import '../styles/feed.css';

import {
  Button,
  Card,
  Header,
  Segment
} from 'semantic-ui-react';

import * as Plot from '@observablehq/plot';

import Feed from './Feed';
import Quote from './Quote';
import Rate from './Rate';

function cryptoRandomSignedUnit () {
  const buf = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buf);
  const sign = (buf[0] & 1) === 0 ? -1 : 1;
  const magnitude = buf[1] / 0xffffffff;
  return sign * magnitude;
}

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
  };

  constructor (props = {}) {
    super(props);

    this._state = {
      assets: {},
      content: this.state
    };

    this.ref = React.createRef();
    this.chartOuterRef = React.createRef();
  }

  componentDidMount () {
    const self = this;

    self._monitor = setInterval(async () => {
      const _GET = async function _GET (path) {
        const delta = cryptoRandomSignedUnit();

        switch (path) {
          case '/quotes':
            return self.state.quotes.concat({
              created: (new Date()).toISOString(),
              delta,
              rate: self.state.quotes[self.state.quotes.length - 1].rate + delta,
              currency: 'USD',
              symbol: 'BTC'
            });
          default:
            return {
              quotes: self.state.quotes
            };
        }
      };

      const simulator = { _GET };

      const remote = simulator;
      const result = await remote._GET('/quotes');
      self._state.content.quotes = result;
      self.setState(self._state.content, () => self._syncChartIntoDom());
    }, 2500);

    self._syncChartIntoDom();
  }

  componentDidUpdate (_, prevState) {
    if (prevState.quotes !== this.state.quotes) {
      this._syncChartIntoDom();
    }
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

  _syncChartIntoDom () {
    const mount = this.chartOuterRef?.current;
    if (!mount) return;
    while (mount.firstChild) {
      mount.removeChild(mount.firstChild);
    }
    const svg = this._buildChartSvgEl();
    if (svg) {
      mount.appendChild(svg);
    }
  }

  _buildChartSvgEl () {
    const quotes = [].concat(this.state.quotes).sort((a, b) => {
      return (Date.parse(a.created) > Date.parse(b.created)) ? -1 : 1;
    });

    const width =
      this.chartOuterRef?.current?.offsetWidth
        ? this.chartOuterRef.current.offsetWidth
        : 600;

    return Plot.line(quotes.map((x) => {
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
      width,
      x: { tickRotate: 45 }
    });
  }

  render () {
    const quotes = [].concat(this.state.quotes).sort((a, b) => {
      return (Date.parse(a.created) > Date.parse(b.created)) ? -1 : 1;
    });

    const quoteView = quotes.slice(0, LIMIT_PER_PAGE);
    const outOfBounds = quotes.length - quoteView.length;

    return (
      <fabric-content-page className="ui page" ref={this.ref}>
        <Segment>
          <Header><h1>Price</h1></Header>
          <Feed />

          <Header><h2>Symbols</h2></Header>
          <div className="ui cards">
            {this.state.symbols.map((symbol) => (
              <Card key={symbol}>
                <Card.Content>
                  <Header>{symbol}</Header>
                  <Rate currency={this.state.currency} symbol={symbol} />
                </Card.Content>
              </Card>
            ))}
          </div>

          <Header><h2>Quotes</h2></Header>
          <Segment
            ref={this.chartOuterRef}
            className="chart ui segment"
          />
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
            {(outOfBounds) ? (
              <Card>
                <Card.Content>
                  <Button>{outOfBounds} more</Button>
                </Card.Content>
              </Card>
            ) : undefined}
          </div>
        </Segment>
        {/* <FabricBridge host="localhost" secure="false" port="3000" /> */}
      </fabric-content-page>
    );
  }
}
