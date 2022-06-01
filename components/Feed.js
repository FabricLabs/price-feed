import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import '../styles/feed.css';
import '../libraries/fomantic/dist/semantic.css';
import {
  Card,
  Icon,
  Label
} from 'semantic-ui-react';

import FabricBridge from '@fabric/react';

export default class Feed extends Component {
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
        <FabricBridge host="localhost" secure="false" port="3000" />
        {/* <FabricBridge ref={this.bridge} host={this.state.http.host} port={this.state.http.port} secure={this.state.http.secure} remoteReady={this._handleRemoteReady.bind(this)} onChange={this._handleBridgeChange.bind(this)} /> */}
      </div>
    );
  }
};
