/**
 * Live price feed component.
 */
// Dependencies
import * as React from 'react';

// Styles
import '../styles/feed.css';
import '../libraries/fomantic/dist/fomantic.css';
import {
  Card,
  Icon,
  Label
} from 'fomantic-ui-react';

// Fabric Components
// import FabricBridge from '@fabric/react';

// Define our component
export default class Feed extends React.Component {
  state = {
    currency: 'BTC',
    prices: {
      'BTC': 1
    },
    quote: {
      created: (new Date()).toISOString(),
      currency: 'BTC',
      rate: 1
    }
  }

  constructor (props = {}) {
    super(props);

    this.settings = Object.assign({}, props);
    this._state = {
      content: this.state // TODO: inherit get state () from Actor
    };

    return this;
  }

  trust (source) {
    source.on('log', this._handleSourceLog.bind(this));
  }

  _handleBridgeReady (info) {
    console.log('[FEED] Bridge Reported Ready:', info);
    // TODO: bind events
    // i.e., this.trust( info.emitter )
  }

  _handleSourceLog (log) {
    this.emit('log', `Source log: ${log}`);
  }

  render () {
    return (
      <>
        <fabric-content-block>
          <Card fluid>
            <Card.Content>
              <Label>Price: <Label.Detail>{this.state.quote.rate}</Label.Detail></Label>
            </Card.Content>
            <Card.Content extra>
              <a>
                <Icon name='linkify' />
              </a>
            </Card.Content>
          </Card>
        </fabric-content-block>
      </>
    );
  }
};
