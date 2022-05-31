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
// import serve from 'rollup-plugin-serve';
// import livereload from 'rollup-plugin-livereload';

export default [
  {
    input: 'components/Feed.js',
    output: [
      {
        file: 'assets/feed.js',
        format: 'iife',
        name: 'PortalFeed'
      }
    ],
    plugins: [
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
        presets: ["@babel/preset-react"],
        babelHelpers: 'runtime',
        skipPreflightCheck: true,
      }),
      commonjs(),
      /* serve({
        open: true,
        contentBase: ['', 'assets'],
        host: 'localhost',
        port: 3000
      }) */,
      // livereload({ watch: 'components' })
    ],
    onwarn(warning, warn) {
      const { code, importer } = warning;
      if (code === "CIRCULAR_DEPENDENCY" && importer.includes("semantic-ui-react")) return;
      warn(warning);
    },
  }
];
