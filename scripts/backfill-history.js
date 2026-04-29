#!/usr/bin/env node
'use strict';

/**
 * Deterministic OHLC backfill (closed candles, **open** time as Unix seconds).
 *
 * Examples:
 *   node scripts/backfill-history.js --start 2021-01-01 --end 2021-01-08 --interval 86400
 *   node scripts/backfill-history.js --start 2021-01-01T00:00:00Z --end 2021-01-02T00:00:00Z --interval 3600 --providers coinbase,bitstamp
 *
 * Note: Kraken returns only ~721 recent buckets; include `kraken` for short trailing windows.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchMultiProviderHistory } = require('../services/historical');

function parseArgs (argv) {
  /** @type {Record<string, string|undefined>} */
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = '1';
      }
    }
  }
  return flags;
}

function usage () {
  console.error(`
Usage: node scripts/backfill-history.js --start <ISO|ms|sec> --end <ISO|ms|sec> --interval <seconds> [--providers coinbase,bitstamp,kraken] [--out path.json] [--delay-ms N]

  --interval   Candle size in seconds (must match venue: Coinbase 60,300,900,3600,21600,86400;
               Bitstamp 60,180,300,900,1800,3600,86400; Kraken maps to whole-minute intervals).

  --providers  Comma-separated subset (default coinbase,bitstamp).

  --delay-ms   Pause between HTTP chunks (public API rate limits; e.g. 200–400).
`.trim());
}

function parseTime (raw) {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  if (/^\d{10}$/.test(s)) return Number(s);
  if (/^\d{13}$/.test(s)) return Math.floor(Number(s) / 1000);
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  return NaN;
}

async function main () {
  const flags = parseArgs(process.argv);
  if (flags.help || flags.h) {
    usage();
    process.exit(0);
  }

  const startSec = parseTime(flags.start);
  const endSec = parseTime(flags.end);
  const intervalSec = Math.floor(Number(flags.interval));

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    usage();
    process.exit(1);
  }
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    usage();
    process.exit(1);
  }

  const providers = String(flags.providers || 'coinbase,bitstamp')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const delayMs = Math.max(
    0,
    Math.floor(Number(flags['delay-ms'] ?? flags.delayMs ?? 0))
  );

  const bundle = await fetchMultiProviderHistory({
    startSec,
    endSec,
    intervalSec,
    providers,
    delayMs
  });

  const outPath = flags.out
    ? path.resolve(process.cwd(), flags.out)
    : null;

  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  if (outPath) {
    await fs.writeFile(outPath, text, 'utf8');
    console.error(`Wrote ${outPath}`);
  } else {
    process.stdout.write(text);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
