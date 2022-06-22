/**
 * # Sample Rollup for Fabric
 */
import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import css from 'rollup-plugin-import-css';
import json from '@rollup/plugin-json';
import url from '@rollup/plugin-url';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import nodeGlobals from 'rollup-plugin-node-globals';

const plugins = [
  css(),
  json(),
  url(),
  nodeGlobals(),
  nodePolyfills(),
  babel({
    presets: ['@babel/preset-react'],
    babelHelpers: 'bundled',
    // skipPreflightCheck: true,
    exclude: ['node_modules/**','**/node_modules/**'],
  }),
  commonjs({
    include: 'node_modules/**',
    transformMixedEsModules: true
  }),
  replace({
    preventAssignment: true,
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }),
];

function onwarn (warning, warn) {
  const { code, importer } = warning;
  if (code === 'CIRCULAR_DEPENDENCY' && importer.includes('fomantic-ui-react')) return;
  warn(warning);
}

export default [
  {
    input: 'scripts/index.js',
    output: [
      {
        file: 'assets/index.js',
        format: 'iife',
        name: 'PortalFeedMonitor',
        globals: {
          '@observablehq/plot': 'Plot',
          'buffer': 'buffer',
          'crypto': 'crypto',
          'querystring': 'querystring',
          'stream': 'stream',
          'url': 'url',
          'punycode': 'punycode',
          'zlib': 'zlib',
          'events': 'events',
          'net': 'net',
          'tls': 'tls',
          'stream': 'stream',
          'lodash.merge': 'merge',
          'https': 'https',
          'react': 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'client',
          'fomantic-ui-react': 'fomanticUIReact',
          'bip39': 'bip39',
          'trezor-connect': 'TrezorConnect'
        },
      }
    ],
    external: [
      '@fabric/react',
      '@observablehq/plot',
      'fomantic-ui-react',
      'react',
      'react-dom/client',
    ],
    plugins: plugins,
    onwarn: onwarn,
    context: 'null',
    moduleContext: 'null',
  }
];
