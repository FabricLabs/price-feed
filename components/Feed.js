import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import '../styles/feed.css';
import '../libraries/fomantic/dist/semantic.css';
import {
  Card,
  Label
} from 'semantic-ui-react';

// import FabricBridge from '@fabric/react';

class Feed extends Component {
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

  render () {
    return (
      <div className="ui page">
        <div><strong>Price:</strong> <code>{this.state.quote.rate}</code></div>
        <hr />
        <Card>
          <Card.Content>
            <Label>Price: <Label.Detail>{this.state.quote.rate}</Label.Detail></Label>
          </Card.Content>
        </Card>
        {/* <FabricBridge host="localhost" secure="false" port="3000" /> */}
      </div>
    );
  }
}

ReactDOM.render(<Feed />, document.getElementById('feed'));
