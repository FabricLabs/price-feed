var PortalFeed = (function (React, semanticUiReact, FabricBridge) {
  'use strict';

  function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

  var React__default = /*#__PURE__*/_interopDefaultLegacy(React);
  var FabricBridge__default = /*#__PURE__*/_interopDefaultLegacy(FabricBridge);

  /**
   * Live price feed component.
   */

  class Feed extends React.Component {
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
      return /*#__PURE__*/React__default["default"].createElement("fabric-content-block", null, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Card, {
        fluid: true
      }, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Card.Content, null, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Label, null, "Price: ", /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Label.Detail, null, this.state.quote.rate))), /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Card.Content, {
        extra: true
      }, /*#__PURE__*/React__default["default"].createElement("a", null, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Icon, {
        name: "linkify"
      })))), /*#__PURE__*/React__default["default"].createElement(FabricBridge__default["default"], {
        host: "localhost",
        secure: "false",
        port: "3000"
      }));
    }

  }

  return Feed;

})(React, semanticUiReact, FabricBridge);
