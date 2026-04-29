#!/usr/bin/env node
/**
 * Copy Fomantic bundle to `assets/index.css` (referenced by `assets/index.html`).
 * Run after `libraries/fomantic` gulp emits `dist/semantic.css`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const semanticPath = path.join(root, 'libraries', 'fomantic', 'dist', 'semantic.css');
const outPath = path.join(root, 'assets', 'index.css');

if (!fs.existsSync(semanticPath)) {
  console.error('[merge-theme-css] Missing Semantic build:', semanticPath);
  console.error('[merge-theme-css] Run npm run build:semantic (gulp) first.');
  process.exit(1);
}

fs.copyFileSync(semanticPath, outPath);
console.log('[merge-theme-css]', '→', path.relative(root, outPath), `(from ${path.relative(root, semanticPath)})`);
