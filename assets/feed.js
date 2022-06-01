(function (React, ReactDOM, semanticUiReact, FabricBridge) {
  'use strict';

  function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

  var React__default = /*#__PURE__*/_interopDefaultLegacy(React);
  var ReactDOM__default = /*#__PURE__*/_interopDefaultLegacy(ReactDOM);
  var FabricBridge__default = /*#__PURE__*/_interopDefaultLegacy(FabricBridge);

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

    render() {
      return /*#__PURE__*/React__default["default"].createElement("div", {
        className: "ui page"
      }, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Card, {
        fluid: true
      }, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Card.Content, null, /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Label, null, "Price: ", /*#__PURE__*/React__default["default"].createElement(semanticUiReact.Label.Detail, null, this.state.quote.rate)))), /*#__PURE__*/React__default["default"].createElement(FabricBridge__default["default"], {
        host: "localhost",
        secure: "false",
        port: "3000"
      }));
    }

  }

  ReactDOM__default["default"].render( /*#__PURE__*/React__default["default"].createElement(Feed, null), document.getElementById('feed'));

})(React, ReactDOM, SemanticUIReact, FabricBridge);
