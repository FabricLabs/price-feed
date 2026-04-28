/**
 * Live price feed component.
 */

import React from 'react';

import '../styles/feed.css';
import '../libraries/fomantic/dist/semantic.css';
import {
  Card,
  Icon,
  Label
} from 'semantic-ui-react';

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
  };

  constructor (props = {}) {
    super(props);

    this.settings = Object.assign({}, props);
    this._state = {
      content: this.state
    };
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
      <fabric-content-block>
        <Card fluid>
          <Card.Content>
            <Label>
              Price: <Label.Detail>{this.state.quote.rate}</Label.Detail>
            </Label>
          </Card.Content>
          <Card.Content extra>
            <a href="#" onClick={(e) => { e.preventDefault(); }} aria-label="Link placeholder">
              <Icon name='linkify' />
            </a>
          </Card.Content>
        </Card>
      </fabric-content-block>
    );
  }
}
