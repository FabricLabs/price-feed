(function (React, client, fomanticUiReact, Plot) {
  'use strict';

  function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = Object.create(null);
    if (e) {
      Object.keys(e).forEach(function (k) {
        if (k !== 'default') {
          var d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: function () { return e[k]; }
          });
        }
      });
    }
    n["default"] = e;
    return Object.freeze(n);
  }

  var React__namespace = /*#__PURE__*/_interopNamespace(React);
  var Plot__namespace = /*#__PURE__*/_interopNamespace(Plot);

  /**
   * Live price feed component.
   */
  // import FabricBridge from '@fabric/react';
  // Define our component

  class Feed extends React__namespace.Component {
    state = {
      currency: 'BTC',
      prices: {
        'BTC': 1
      },
      quote: {
        created: new Date().toISOString(),
        currency: 'BTC',
        rate: 1
      }
    };

    constructor(props = {}) {
      super(props);
      this.settings = Object.assign({}, props);
      this._state = {
        content: this.state // TODO: inherit get state () from Actor

      };
      return this;
    }

    trust(source) {
      source.on('log', this._handleSourceLog.bind(this));
    }

    _handleBridgeReady(info) {
      console.log('[FEED] Bridge Reported Ready:', info); // TODO: bind events
      // i.e., this.trust( info.emitter )
    }

    _handleSourceLog(log) {
      this.emit('log', `Source log: ${log}`);
    }

    render() {
      return /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, /*#__PURE__*/React__namespace.createElement("fabric-content-block", null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card, {
        fluid: true
      }, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card.Content, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Label, null, "Price: ", /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Label.Detail, null, this.state.quote.rate))), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card.Content, {
        extra: true
      }, /*#__PURE__*/React__namespace.createElement("a", null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Icon, {
        name: "linkify"
      }))))));
    }

  }

  /**
   * Live price feed component.
   */

  const label = {
    textAlign: 'right'
  }; // Define our component

  class Quote extends React__namespace.Component {
    constructor(props = {}) {
      super(props);
      this.settings = Object.assign({
        frequency: 0.007
      }, this.state, props);
      this.state = { ...this.props
      };
      this._state = {
        content: Object.assign({
          age: 0,
          created: new Date().toISOString(),
          currency: 'USD',
          rate: 29349.54,
          symbol: 'BTC'
        }, this.state) // TODO: inherit get state () from Actor

      };
      return this;
    }

    get locale() {
      return Intl.NumberFormat().resolvedOptions().locale;
    }

    get rate() {
      return this.state.value;
    }

    componentDidMount() {
      const self = this;
      self._timekeeper = setInterval(() => {
        self._state.content.age = Date.now() - Date.parse(this.state.created);
        self.setState(self._state.content);
      }, self.settings.frequency);
    }

    withLocale(value) {
      if (typeof value !== 'Number') value = parseFloat(value);
      return value.toLocaleString(this.locale);
    }

    render() {
      return /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, /*#__PURE__*/React__namespace.createElement("portal-feed-quote", null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Segment, {
        compact: true
      }, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Header, null), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Body, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Row, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, {
        style: label
      }, /*#__PURE__*/React__namespace.createElement("strong", {
        htmlFor: "symbol"
      }, "Symbol:")), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, null, /*#__PURE__*/React__namespace.createElement("code", {
        "data-bind": "symbol"
      }, this.state.symbol))), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Row, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, {
        style: label
      }, /*#__PURE__*/React__namespace.createElement("strong", {
        htmlFor: "currency"
      }, "Currency:")), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, null, /*#__PURE__*/React__namespace.createElement("code", {
        "data-bind": "currency"
      }, this.state.currency))), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Row, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, {
        style: label
      }, /*#__PURE__*/React__namespace.createElement("strong", {
        htmlFor: "rate"
      }, "Rate:")), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, null, /*#__PURE__*/React__namespace.createElement("code", {
        "data-bind": "rate"
      }, this.state.rate.toFixed(2)))), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Row, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, {
        style: label
      }, /*#__PURE__*/React__namespace.createElement("strong", {
        htmlFor: "symbol"
      }, "Age:")), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Table.Cell, null, /*#__PURE__*/React__namespace.createElement("abbr", {
        "data-bind": "age",
        title: this.state.created
      }, this.state.age, " ms"))))))));
    }

  }

  /**
   * Live price feed component.
   */

  class Rate extends React__namespace.Component {
    state = {
      value: 29349.54,
      currency: 'USD',
      symbol: 'BTC'
    };

    constructor(props = {}) {
      super(props);
      this.settings = Object.assign({}, this.state, props);
      this._state = {
        content: this.state // TODO: inherit get state () from Actor

      };
      return this;
    }

    get locale() {
      return Intl.NumberFormat().resolvedOptions().locale;
    }

    get price() {
      return this.state.value;
    }

    withLocale(value) {
      if (typeof value !== 'Number') value = parseFloat(value);
      return value.toLocaleString(this.locale);
    }

    render() {
      return /*#__PURE__*/React__namespace.createElement(React__namespace.Fragment, null, /*#__PURE__*/React__namespace.createElement("portal-feed-rate", null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Segment, {
        compact: true
      }, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Label, {
        htmlFor: "currency"
      }, this.state.currency), /*#__PURE__*/React__namespace.createElement("code", {
        "data-bind": "price",
        style: {
          display: 'inline-block',
          marginLeft: '1em'
        }
      }, this.withLocale(this.state.value)))));
    }

  }

  const LIMIT_PER_PAGE = 3;
  class FeedMonitor extends React__namespace.Component {
    state = {
      currency: 'USD',
      symbols: ['BTC', 'NMC', 'LTC'],
      quotes: [{
        created: new Date().toISOString(),
        rate: 29349.54,
        currency: 'USD',
        symbol: 'BTC'
      }]
    };

    constructor(props = {}) {
      super(props);
      this._state = {
        assets: {},
        content: this.state // TODO: inherit get state () from Actor

      };
      this.ref = /*#__PURE__*/React__namespace.createRef();
      this.chart = /*#__PURE__*/React__namespace.createRef();
      return this;
    }

    componentDidMount() {
      const self = this;
      self._monitor = setInterval(async () => {
        const _GET = async function _GET(path) {
          const delta = (Math.random() < 0.5 ? 1 : -1) * Math.random();

          switch (path) {
            default:
              return {
                quotes: self.state.quotes
              };

            case '/quotes':
              return self.state.quotes.concat({
                created: new Date().toISOString(),
                delta: delta,
                rate: self.state.quotes[self.state.quotes.length - 1].rate + delta,
                currency: 'USD',
                symbol: 'BTC'
              });
          }
        };

        const simulator = {
          _GET
        };
        const remote = simulator; // new Remote({ authority: 'localhost:3000' });

        const result = await remote._GET('/quotes');
        self._state.content.quotes = result;
        self.setState(self._state.content);
      }, 2500);
    }

    trust(source) {
      source.on('log', this._handleSourceLog.bind(this));
    }

    _handleBridgeReady(info) {
      console.log('[FEED] Bridge Reported Ready:', info);
    }

    _handleSourceLog(log) {
      this.emit('log', `Source log: ${log}`);
    }

    render() {
      const quotes = [].concat(this.state.quotes).sort((a, b) => {
        return Date.parse(a.created) > Date.parse(b.created) ? -1 : 1;
      });
      const quoteView = quotes.slice(0, LIMIT_PER_PAGE);
      const outOfBounds = quotes.length - quoteView.length;
      const chart = Plot__namespace.line(quotes.map(x => {
        return { ...x,
          created: new Date(x.created)
        };
      }), {
        x: 'created',
        y: 'rate'
      }).plot({
        marginBottom: 50,
        marginLeft: 75,
        width: this.chart.current ? this.chart.current.offsetWidth : 600,
        x: {
          tickRotate: 45
        }
      });
      return /*#__PURE__*/React__namespace.createElement("fabric-content-page", {
        className: "ui page",
        ref: this.ref
      }, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Segment, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Header, null, /*#__PURE__*/React__namespace.createElement("h1", null, "Price")), /*#__PURE__*/React__namespace.createElement(Feed, null), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Header, null, /*#__PURE__*/React__namespace.createElement("h2", null, "Symbols")), /*#__PURE__*/React__namespace.createElement("div", {
        className: "ui cards"
      }, this.state.symbols.map((symbol, i) => {
        return /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card, {
          key: i
        }, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card.Content, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Header, null, symbol), /*#__PURE__*/React__namespace.createElement(Rate, {
          currency: this.state.currency,
          symbol: symbol
        })));
      })), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Header, null, /*#__PURE__*/React__namespace.createElement("h2", null, "Quotes")), /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Segment, {
        ref: this.chart,
        class: "chart",
        dangerouslySetInnerHTML: {
          __html: chart.outerHTML
        }
      }), /*#__PURE__*/React__namespace.createElement("div", {
        className: "ui cards"
      }, quoteView.map((quote, i) => {
        const id = quotes.length - i;
        return /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card, {
          key: id
        }, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card.Content, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Header, null, /*#__PURE__*/React__namespace.createElement("strong", null, "Quote #", id)), /*#__PURE__*/React__namespace.createElement(Quote, {
          symbol: quote.symbol,
          currency: quote.currency,
          rate: quote.rate
        })));
      }), outOfBounds ? /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Card.Content, null, /*#__PURE__*/React__namespace.createElement(fomanticUiReact.Button, null, outOfBounds, " more"))) : undefined)));
    }

  }

  // Dependencies

  const settings = {
    currency: 'USD',
    symbols: ['BTC', 'LTC', 'NMC']
  }; // Main Process Definition

  async function main(input = {}) {
    const container = document.getElementById('feed');
    const root = client.createRoot(container);
    root.render( /*#__PURE__*/React__namespace.createElement(FeedMonitor, {
      state: input
    }));
    return {
      react: {
        root
      }
    };
  } // Run Main Process


  main(settings).catch(exception => {
    console.error('[PORTAL:FEED] Main Process Exception:', exception);
  }).then(output => {
    console.log('[PORTAL:FEED] Main Process Output:', output);
  });

})(React, client, fomanticUIReact, Plot);
