/**
 * # Sample Rollup for Fabric
 */
import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import css from 'rollup-plugin-import-css';
import json from '@rollup/plugin-json';
import url from '@rollup/plugin-url';

const plugins = [
  resolve({
    extensions: ['.js']
  }),
  replace({
    preventAssignment: true,
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }),
  css(),
  json(),
  url(),
  babel({
    presets: ['@babel/preset-react'],
    babelHelpers: 'runtime',
    skipPreflightCheck: true,
    exclude: '**/node_modules/**',
  }),
  commonjs({
    include: 'node_modules/**'
  })
];

function onwarn (warning, warn) {
  const { code, importer } = warning;
  if (code === 'CIRCULAR_DEPENDENCY' && importer.includes('semantic-ui-react')) return;
  warn(warning);
}

export default [
  {
    input: 'scripts/index.js',
    output: [
      {
        file: 'assets/index.js',
        format: 'iife',
        name: 'PortalFeedMonitor'
      }
    ],
    plugins: plugins,
    onwarn: onwarn
  }
];
