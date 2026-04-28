/**
 * Browser bundle → assets/index.js (IIFE loaded by Hub / static hosts).
 */
import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import css from "rollup-plugin-import-css";
import json from "@rollup/plugin-json";
import url from "@rollup/plugin-url";

const plugins = [
  resolve({
    extensions: [".js"],
    browser: true,
  }),
  replace({
    preventAssignment: true,
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  }),
  css(),
  json(),
  url(),
  babel({
    babelHelpers: "bundled",
    babelrc: false,
    presets: ["@babel/preset-react"],
    exclude: "node_modules/**",
  }),
  commonjs({
    include: "node_modules/**",
  }),
];

function onwarn(warning, defaultHandler) {
  if (warning.code === "CIRCULAR_DEPENDENCY") return;
  defaultHandler(warning);
}

export default [
  {
    input: "scripts/index.js",
    output: [
      {
        file: "assets/index.js",
        format: "iife",
        name: "PortalFeedMonitor",
        globals: {
          buffer: "buffer",
          crypto: "crypto",
          punycode: "punycode",
          zlib: "zlib",
          events: "events",
          net: "net",
          tls: "tls",
          querystring: "querystring",
          stream: "stream",
          url: "url",
          "lodash.merge": "merge",
          https: "https",
          react: "React",
          "react-dom": "ReactDOM",
          "semantic-ui-react": "semanticUIReact",
          bip39: "bip39",
          "trezor-connect": "TrezorConnect",
        },
      },
    ],
    plugins,
    onwarn,
  },
];
