import React, { Component } from 'react';
import ReactDOM from 'react-dom';


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
      <div>
        <div><strong>Price:</strong> <code>{this.state.quote.rate}</code></div>
      </div>
    );
  }
}

ReactDOM.render(<Feed />, document.getElementById('feed'));
