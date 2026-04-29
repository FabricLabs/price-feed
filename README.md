# `@fabric/price`
Price feed for digital assets.

## Quick Start
0. `npm install`
1. `npm run quote`

## Configuration
Modify `settings/local.js` to change runtime configuration.

## Running a Node
Follow quick start (above), then: `npm start` (runs `scripts/node.js` with `settings/local.js`).

### Local HTTP price report
By default `http.port` comes from settings (8080 unless you override it). **`@fabric/http` listens on `http.host` (defaults include `localhost`);** if you probe with `curl`/`fetch` against `127.0.0.1`, align `host` to `127.0.0.1` in config or use `http://localhost:<port>/…` everywhere.

Aggregated snapshot (unsigned; signed reports use `generateReport()` which adds `attestation`):

```
GET http://localhost:8080/feed/report
```

Response includes:

- `currency`, `quoteCurrency`, `symbols`, `service`
- `values` — keyed by asset symbol (e.g. `BTC`), each entry has `price`, `sourceCount`, and `sources` (per-provider rows with labels and optional `fromCache`).
- `priceHistory` — array of `{ id, ts, schema, values }` snapshots (same cap as `persist.maxHistoryRows`). Omitted from signed `generateReport()` attestation payload; disable with `persist.exposePriceHistoryInReport: false`.

Persistence uses `persist.path` under settings (defaults to `./stores/feed-price`). With `sync: true`, outbound provider calls run on load and repeat on each report pull.

### Tests
- `npm test` — unit/integration tests under `tests/` (including `tests/feed.http.test.cjs`: HTTP `/feed/report` against mocked upstreams).
- `npm run test:integration` — `tests/integration/**` only.

## Other Tools
- `npm run coverage` — generate code coverage report
- `npm run quote` — retrieve a one-time quote

## Architecture (beginner)

Think of three layers:

1. **Node service (`services/feed.js`)** — `Feed` extends Fabric `Service`. It owns quote providers (BitPay, Coinbase, …), calls each `getQuoteForSymbol('BTC')`, blends prices with **inverse-age weighting** (same “as-of” time logic as `types/quoteTime.js`), persists to LevelDB, and registers **`GET /feed/report`** on the Fabric HTTP server.
2. **HTTP to exchanges (`types/worker.js`)** — Each exchange integration uses a **Worker**: thin wrapper around Fabric `Remote` with a **per-request timeout** (`timeoutMs`, default 14s) and the only supported path for outbound REST. Feed-wide **429/503 backoff** uses `Worker` static helpers so rate limits are handled in one place.
3. **Browser dashboard (`scripts/index.js` → `components/FeedMonitor.js`)** — Static/bundled React app that **polls** `/feed/report`, shows the weighted price, provider health, optional **source filters** (client recomputes weights with `quoteAsOfMs` from `types/quoteTime.js` so it matches the server), and charts.

**Process entry:** `scripts/node.js` loads settings (e.g. `settings/local.js`), starts `Feed` (and often `FeedNode` for quieter logs / pricing summaries).

**Not covered by Worker:** `services/utxoracle.js` talks to **Bitcoin Core** over RPC. A stuck node can still delay aggregation until you fix RPC, lower activity, or disable that source in settings.

## How does it work?
`@fabric/price` uses a **weighted average** of multiple sources, including both on-chain and exchange data.

## UTXOracle (on-chain BTC/USD)

There is **no separate academic paper** for UTXOracle. The authoritative description is the **commentary and stepwise specification inside** [`UTXOracle.py`](https://github.com/Unbesteveable/UTXOracle) (v9.1 matches [`utxo.live/oracle/UTXOracle.py`](https://utxo.live/oracle/UTXOracle.py)), plus the high-level explanation at [utxo.live/oracle/explain.php](https://utxo.live/oracle/explain.php). Background for a general audience: [Nasdaq — A New Trustless Way to Calculate the Bitcoin Price](https://www.nasdaq.com/articles/a-new-trustless-way-to-calculate-the-bitcoin-price).

This repo implements **Steps 5–11** of that script using Bitcoin Core **`getblock` verbosity 2** instead of reading raw block files. A copy of the reference script is kept at `vendor/UTXOracle.py` for diffing.

### Local Bitcoin (UTXOracle on regtest)

`settings/local.js` wires **`bitcoin`** for a **managed regtest** node (`network: 'regtest'`, data under `./stores/bitcoin-regtest`) and enables **`sources.utxoracle`**. `npm start` / `npm run quote` will start `bitcoind` via `@fabric/core` if it is on your `PATH`.

1. Install [Bitcoin Core](https://bitcoincore.org/) so `bitcoind` is available.
2. Optionally mine a chain tip above your window (default 144 blocks), e.g. after the feed has started once or using the same datadir:

```bash
bitcoin-cli -datadir="$(pwd)/stores/bitcoin-regtest" createwallet regtest || true
ADDR=$(bitcoin-cli -datadir="$(pwd)/stores/bitcoin-regtest" getnewaddress)
bitcoin-cli -datadir="$(pwd)/stores/bitcoin-regtest" generatetoaddress 200 "$ADDR"
```

3. **UTXOracle** needs blocks with transactions that pass its filters (round-fiat-like patterns). Empty or coinbase-only regtest chains usually yield no on-chain estimate; the provider is skipped and the weighted quote still uses BitPay/Coinbase/etc.

For **mainnet** (large download / pruning), set e.g. `bitcoin: { managed: true, network: 'mainnet', constraints: { storage: { size: 550 } } }` and point at your own node if you disable `managed`.

We enable providers for:

- BitPay
- Coinbase
- CoinMarketCap

## Credits
- @VictorWu
