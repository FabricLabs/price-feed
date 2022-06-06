import React from 'react';
import '../styles/feed.css';
// import '../libraries/fomantic/dist/semantic.css';
import {
  Segment
} from 'semantic-ui-react';

// import FabricBridge from '@fabric/react';
import Feed from './Feed';

export default class FeedMonitor extends React.Component {
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
  }

  _handleSourceLog (log) {
    this.emit('log', `Source log: ${log}`);
  }

  render () {
    return (
      <fabric-content-page class="ui page">
        <Segment>
          <Feed />
        </Segment>
        {/* <FabricBridge host="localhost" secure="false" port="3000" /> */}
      </fabric-content-page>
    );
  }
}
