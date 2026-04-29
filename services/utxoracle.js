'use strict';

/**
 * On-chain USD/BTC (UTXOracle family): histogram, stencil alignment, intraday refinement.
 *
 * **Normative reference** (no separate paper): `vendor/UTXOracle.py` **v9.1** (“RPC Only”),
 * same as https://github.com/Unbesteveable/UTXOracle and https://utxo.live/oracle/UTXOracle.py
 * — methodology is the numbered Steps 5–11 in that file. See also https://utxo.live/oracle/explain.php
 * and https://github.com/Unbesteveable/UTXOracle (overview).
 *
 * This port follows those steps using Bitcoin Core **`getblock` … 2** instead of parsing raw blk files.
 * Step 11 in v9.1 defines `while central_price not in avs:` but adds `central_price` to `avs`
 * before the loop, so the loop never runs; behavior matches a **single** `find_central_output` pass
 * after the ±5% rough-price window (same as stock Python output).
 */

/** @typedef {{ call: function(string, unknown[]): Promise<unknown> }} BitcoinRpc */

const QuoteProvider = require('../types/quoteProvider');
const Bitcoin = require('@fabric/core/services/bitcoin');
const { httpsRequestCaptured } = require('./outboundHttps');

/** Max samples per {@link UTXOracle#estimateUsdHeightSeries} call (one `estimateUsdAtHeight` per step). */
const ESTIMATE_HEIGHT_SERIES_MAX_POINTS = 2500;

const LOG_E = Math.E;

function log10 (x) {
  return Math.log(x) / Math.log(10);
}

function buildOutputHistogramBins () {
  const firstBinValue = -6;
  const lastBinValue = 6;
  const rangeBinValues = lastBinValue - firstBinValue;

  /** @type {number[]} */
  const output_histogram_bins = [0.0];

  for (let exponent = -6; exponent < 6; exponent++) {
    for (let b = 0; b < 200; b++) {
      const bin_value = 10 ** (exponent + b / 200);
      output_histogram_bins.push(bin_value);
    }
  }

  const number_of_bins = output_histogram_bins.length;
  /** @type {number[]} */
  const output_histogram_bin_counts = [];
  for (let n = 0; n < number_of_bins; n++) {
    output_histogram_bin_counts.push(0.0);
  }

  return {
    output_histogram_bins,
    output_histogram_bin_counts,
    first_bin_value: firstBinValue,
    last_bin_value: lastBinValue,
    range_bin_values: rangeBinValues,
    number_of_bins
  };
}

function prepareStencils () {
  const num_elements = 803;
  const mean = 411;
  const std_dev = 201;
  /** @type {number[]} */
  const smooth_stencil = [];
  for (let x = 0; x < num_elements; x++) {
    const exp_part = -((x - mean) ** 2) / (2 * (std_dev ** 2));
    smooth_stencil.push((0.00150 * (LOG_E ** exp_part)) + (0.0000005 * x));
  }

  /** @type {number[]} */
  const spike_stencil = new Array(803).fill(0.0);
  spike_stencil[40] = 0.001300198324984352;
  spike_stencil[141] = 0.001676746949820743;
  spike_stencil[201] = 0.003468805546942046;
  spike_stencil[202] = 0.001991977522512513;
  spike_stencil[236] = 0.001905066647961839;
  spike_stencil[261] = 0.003341772718156079;
  spike_stencil[262] = 0.002588902624584287;
  spike_stencil[296] = 0.002577893841190244;
  spike_stencil[297] = 0.002733728814200412;
  spike_stencil[340] = 0.003076117748975647;
  spike_stencil[341] = 0.005613067550103145;
  spike_stencil[342] = 0.003088253178535568;
  spike_stencil[400] = 0.002918457489366139;
  spike_stencil[401] = 0.006174500465286022;
  spike_stencil[402] = 0.004417068070043504;
  spike_stencil[403] = 0.002628663628020371;
  spike_stencil[436] = 0.002858828161543839;
  spike_stencil[461] = 0.004097463611984264;
  spike_stencil[462] = 0.003345917406120509;
  spike_stencil[496] = 0.002521467726855856;
  spike_stencil[497] = 0.002784125730361008;
  spike_stencil[541] = 0.003792850444811335;
  spike_stencil[601] = 0.003688240815848247;
  spike_stencil[602] = 0.002392400117402263;
  spike_stencil[636] = 0.001280993059008106;
  spike_stencil[661] = 0.001654665137536031;
  spike_stencil[662] = 0.001395501347054946;
  spike_stencil[741] = 0.001154279140906312;
  spike_stencil[801] = 0.000832244504868709;

  return { smooth_stencil, spike_stencil };
}

function buildMicroRemoveList () {
  /** @type {number[]} */
  const micro_remove_list = [];
  let i = 0.00005000;
  while (i < 0.0001) {
    micro_remove_list.push(i);
    i += 0.00001;
  }
  i = 0.0001;
  while (i < 0.001) {
    micro_remove_list.push(i);
    i += 0.00001;
  }
  i = 0.001;
  while (i < 0.01) {
    micro_remove_list.push(i);
    i += 0.0001;
  }
  i = 0.01;
  while (i < 0.1) {
    micro_remove_list.push(i);
    i += 0.001;
  }
  i = 0.1;
  while (i < 1) {
    micro_remove_list.push(i);
    i += 0.01;
  }
  return micro_remove_list;
}

/**
 * Find central cluster price (median distance / MAD) — UTXOracle Step 11.
 * @param {number[]} r2
 */
function findCentralOutput (r2, price_min, price_max) {
  const r6 = r2.filter((r) => price_min < r && r < price_max);
  const outputs = [...r6].sort((a, b) => a - b);
  const n = outputs.length;
  if (n === 0) {
    return { central: NaN, mad: NaN };
  }

  /** @type {number[]} */
  const prefix_sum = [];
  let total = 0;
  for (const x of outputs) {
    total += x;
    prefix_sum.push(total);
  }

  const left_counts = Array.from({ length: n }, (_, i) => i);
  const right_counts = left_counts.map((_, i) => n - i - 1);
  /** @type {number[]} */
  const left_sums = [0, ...prefix_sum.slice(0, -1)];
  const right_sums = prefix_sum.map((_, i) => total - prefix_sum[i]);

  /** @type {number[]} */
  const total_dists = [];
  for (let i = 0; i < n; i++) {
    const dist =
      (outputs[i] * left_counts[i] - left_sums[i]) +
      (right_sums[i] - outputs[i] * right_counts[i]);
    total_dists.push(dist);
  }

  let min_index = 0;
  let minVal = total_dists[0];
  for (let i = 1; i < n; i++) {
    if (total_dists[i] < minVal) {
      minVal = total_dists[i];
      min_index = i;
    }
  }
  const best_output = outputs[min_index];

  const deviations = outputs.map((x) => Math.abs(x - best_output));
  deviations.sort((a, b) => a - b);
  const m = deviations.length;
  const mad =
    m % 2 === 0
      ? (deviations[m / 2 - 1] + deviations[m / 2]) / 2
      : deviations[Math.floor(m / 2)];

  return { central: best_output, mad };
}

function witnessExceeds (tx) {
  const vins = Array.isArray(tx.vin) ? tx.vin : [];
  /** @see UTXOracle: only accumulated when witness present (SegWit). */
  for (const vin of vins) {
    const wit = vin.txinwitness;
    if (!Array.isArray(wit)) continue;
    let totalWitnessLen = 0;
    for (const h of wit) {
      if (typeof h !== 'string') continue;
      const bytes = Math.floor(h.length / 2);
      totalWitnessLen += bytes;
      if (bytes > 500 || totalWitnessLen > 500) return true;
    }
  }
  return false;
}

function voutHasOpReturn (tx) {
  const outs = tx.vout || [];
  for (const vo of outs) {
    const sp = vo.scriptPubKey;
    const hex = sp && typeof sp.hex === 'string' ? sp.hex : '';
    const typ = sp && typeof sp.type === 'string' ? sp.type : '';
    if (typ === 'nulldata') return true;
    if (hex.startsWith('6a')) return true;
  }
  return false;
}

/**
 * @param {BitcoinRpc} rpc
 * @param {{ windowBlocks?: number, endHeight?: number }} [opts]
 * `endHeight` — treat chain tip as this height (for replay). Uses blocks
 * `[max(0, endHeight - windowBlocks), endHeight - 1]`; omit to use live `getblockcount`.
 * @returns {Promise<number>}
 */
async function estimateUsdFromRecentBlocks (rpc, opts = {}) {
  const windowBlocks = opts.windowBlocks != null ? Number(opts.windowBlocks) : 144;

  const {
    output_histogram_bins,
    output_histogram_bin_counts,
    first_bin_value,
    range_bin_values,
    number_of_bins
  } = buildOutputHistogramBins();

  const heights = typeof rpc.call === 'function' ? rpc : null;
  if (!heights) throw new Error('Invalid RPC');

  /** @type {number} */
  let finish;
  if (opts.endHeight != null && Number.isFinite(Number(opts.endHeight))) {
    finish = Math.floor(Number(opts.endHeight));
    if (finish < 0) throw new Error('UTXOracle: endHeight must be >= 0');
  } else {
    const blockCount = await rpc.call('getblockcount', []);
    const n = typeof blockCount === 'number' ? blockCount : Number(blockCount);
    finish = Number.isFinite(n) ? n : 0;
  }

  /** @type {number[]} */
  const block_nums_needed = [];
  /** @type {string[]} */
  const block_hashes_needed = [];
  /** @type {number[]} */
  const block_times_needed = [];

  const start = Math.max(0, finish - windowBlocks);

  for (let h = start; h < finish; h++) {
    const bh = /** @type {string} */ (await rpc.call('getblockhash', [h]));
    const hdr = /** @type {{ time?: number }} */ (await rpc.call('getblockheader', [bh, true]));
    block_nums_needed.push(h);
    block_hashes_needed.push(bh);
    block_times_needed.push(hdr.time ?? 0);
  }

  /** @type {number[]} */
  const raw_outputs = [];
  /** @type {number[]} */
  const block_heights_dec = [];
  /** @type {number[]} */
  const block_times_dec = [];

  const seenTxids = new Set();

  for (let bi = 0; bi < block_hashes_needed.length; bi++) {
    const bh = block_hashes_needed[bi];
    const block =
      /** @type {{ tx?: Record<string, unknown>[] }} */
      (await rpc.call('getblock', [bh, 2]));

    const txs = Array.isArray(block.tx) ? block.tx : [];
    const blkH = block_nums_needed[bi];
    const blkT = block_times_needed[bi];

    for (const tx of txs) {
      /** @type {string} */
      const txid = typeof tx.txid === 'string' ? tx.txid : '';
      if (!txid) continue;

      const vin = tx.vin || [];
      const vout = tx.vout || [];
      const input_count = vin.length;
      const output_count = vout.length;

      const is_coinbase = vin.some((x) => x && x.coinbase);

      /** @type {string[]} */
      const input_txids = [];
      for (const inp of vin) {
        if (!inp || !inp.txid) continue;
        input_txids.push(inp.txid);
      }

      /** @type {boolean} */
      const has_op_return = voutHasOpReturn(tx);

      /** match UTXOracle ordering: register txid before same-day spend check */
      seenTxids.add(txid);
      /** @type {boolean} */
      const is_same_day_tx = input_txids.some((tid) => seenTxids.has(tid));

      /** @type {number[]} */
      const output_values = [];
      if (!has_op_return) {
        for (const vo of vout) {
          const vb = typeof vo.value === 'number' ? vo.value : parseFloat(vo.value || '0');
          if (!Number.isFinite(vb)) continue;
          if (1e-5 < vb && vb < 1e5) {
            output_values.push(vb);
          }
        }
      }

      /** @type {number[]} */
      const txs_to_add = [];

      if (
        input_count <= 5 &&
        output_count === 2 &&
        !is_coinbase &&
        !has_op_return &&
        !witnessExceeds(tx) &&
        !is_same_day_tx
      ) {
        for (const amount of output_values) {
          const amount_log = log10(amount);
          const percent_in_range =
            (amount_log - first_bin_value) / range_bin_values;
          let bin_number_est = Math.floor(percent_in_range * number_of_bins);
          while (
            bin_number_est < output_histogram_bins.length &&
            output_histogram_bins[bin_number_est] <= amount
          ) {
            bin_number_est += 1;
          }
          const bin_number = bin_number_est - 1;
          if (bin_number >= 0 && bin_number < output_histogram_bin_counts.length) {
            output_histogram_bin_counts[bin_number] += 1.0;
          }
          txs_to_add.push(amount);
        }
      }

      if (txs_to_add.length > 0) {
        for (const amt of txs_to_add) {
          raw_outputs.push(amt);
          block_heights_dec.push(blkH);
          block_times_dec.push(blkT);
        }
      }
    }
  }

  let n;
  /* Step 7 — truncate + smooth round BTC bins */
  for (n = 0; n < 201; n++) {
    output_histogram_bin_counts[n] = 0;
  }
  for (
    n = 1601;
    n < output_histogram_bin_counts.length;
    n++
  ) {
    output_histogram_bin_counts[n] = 0;
  }

  /** @see vendor/UTXOracle.py round_btc_bins */
  const round_btc_bins = [
    201, 401, 461, 496, 540, 601, 661, 696, 740, 801, 861, 896, 940, 1001, 1061, 1096, 1140, 1201
  ];
  for (const r of round_btc_bins) {
    const amount_above = output_histogram_bin_counts[r + 1];
    const amount_below = output_histogram_bin_counts[r - 1];
    output_histogram_bin_counts[r] = 0.5 * (amount_above + amount_below);
  }

  let curve_sum = 0.0;
  for (n = 201; n < 1601; n++) {
    curve_sum += output_histogram_bin_counts[n];
  }
  if (curve_sum <= 0) {
    throw new Error('UTXOracle: insufficient on-chain volume in window (empty histogram)');
  }

  for (n = 201; n < 1601; n++) {
    output_histogram_bin_counts[n] /= curve_sum;
    if (output_histogram_bin_counts[n] > 0.008) {
      output_histogram_bin_counts[n] = 0.008;
    }
  }

  /* Step 8–9 */
  const { smooth_stencil, spike_stencil } = prepareStencils();

  let best_slide = 0;
  let best_slide_score = 0;
  let total_score = 0;

  const center_p001 = 601;
  const left_p001 = center_p001 - Math.floor((spike_stencil.length + 1) / 2);
  const right_p001 =
    center_p001 + Math.floor((spike_stencil.length + 1) / 2);

  const min_slide = -141;
  const max_slide = 201;

  for (let slide = min_slide; slide < max_slide; slide++) {
    const shifted_curve = output_histogram_bin_counts.slice(
      left_p001 + slide,
      right_p001 + slide
    );
    let slide_score_smooth = 0.0;
    for (let i = 0; i < smooth_stencil.length; i++) {
      slide_score_smooth += shifted_curve[i] * smooth_stencil[i];
    }
    let slide_score = 0.0;
    for (let i = 0; i < spike_stencil.length; i++) {
      slide_score += shifted_curve[i] * spike_stencil[i];
    }

    if (slide < 150) {
      slide_score += slide_score_smooth * 0.65;
    }

    if (slide_score > best_slide_score) {
      best_slide_score = slide_score;
      best_slide = slide;
    }
    total_score += slide_score;
  }

  const usd100_in_btc_best =
    output_histogram_bins[center_p001 + best_slide];
  const btc_in_usd_best = 100 / usd100_in_btc_best;

  const neighbor_up = output_histogram_bin_counts.slice(
    left_p001 + best_slide + 1,
    right_p001 + best_slide + 1
  );
  let neighbor_up_score = 0.0;
  for (let nIx = 0; nIx < spike_stencil.length; nIx++) {
    neighbor_up_score += neighbor_up[nIx] * spike_stencil[nIx];
  }

  const neighbor_down = output_histogram_bin_counts.slice(
    left_p001 + best_slide - 1,
    right_p001 + best_slide - 1
  );
  let neighbor_down_score = 0.0;
  for (let nIx = 0; nIx < spike_stencil.length; nIx++) {
    neighbor_down_score += neighbor_down[nIx] * spike_stencil[nIx];
  }

  let best_neighbor = 1;
  let neighbor_score = neighbor_up_score;
  if (neighbor_down_score > neighbor_up_score) {
    best_neighbor = -1;
    neighbor_score = neighbor_down_score;
  }

  const usd100_in_btc_2nd =
    output_histogram_bins[center_p001 + best_slide + best_neighbor];
  const btc_in_usd_2nd = 100 / usd100_in_btc_2nd;

  const avg_score = total_score / (max_slide - min_slide);
  const a1 = best_slide_score - avg_score;
  const a2 = Math.abs(neighbor_score - avg_score);
  const denom = a1 + a2;
  const w1 = denom === 0 ? 1 : a1 / denom;
  const w2 = denom === 0 ? 0 : a2 / denom;
  const rough_price_estimate = Math.floor(
    w1 * btc_in_usd_best + w2 * btc_in_usd_2nd
  );

  /* Step 10 */
  const usds = [
    5, 10, 15, 20, 25, 30, 40, 50, 100, 150, 200, 300, 500, 1000
  ];
  const pct_range_wide = 0.25;
  const micro_remove_list = buildMicroRemoveList();
  const pct_micro_remove = 0.0001;

  /** @type {number[]} */
  const output_prices = [];

  for (let i = 0; i < raw_outputs.length; i++) {
    const amount = raw_outputs[i];
    for (const usd of usds) {
      const avbtc = usd / rough_price_estimate;
      const btc_up = avbtc + pct_range_wide * avbtc;
      const btc_dn = avbtc - pct_range_wide * avbtc;

      if (btc_dn < amount && amount < btc_up) {
        let append = true;
        for (const r of micro_remove_list) {
          const rm_dn = r - pct_micro_remove * r;
          const rm_up = r + pct_micro_remove * r;
          if (rm_dn < amount && amount < rm_up) {
            append = false;
            break;
          }
        }
        if (append) {
          output_prices.push(usd / amount);
        }
      }
    }
  }

  if (output_prices.length === 0) {
    throw new Error('UTXOracle: could not derive intraday price points');
  }

  let pct_range_tight = 0.05;
  let price_up = rough_price_estimate + pct_range_tight * rough_price_estimate;
  let price_dn = rough_price_estimate - pct_range_tight * rough_price_estimate;
  let centralRes = findCentralOutput(output_prices, price_dn, price_up);
  const central_price = centralRes.central;
  if (!Number.isFinite(central_price)) {
    throw new Error('UTXOracle: central price not found');
  }

  return central_price;
}

/** Default Fabric Hub Bitcoin REST (used when local `getblockchaininfo` is unavailable). */
const HUB_FABRIC_CHAIN_REST_DEFAULT = 'https://hub.fabric.pub';

/**
 * @param {string} hubBase
 * @param {number} height
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function fetchHubBlockAtHeight (hubBase, height) {
  const base = String(hubBase || '').replace(/\/+$/, '');
  const url = `${base}/services/bitcoin/blocks/height/${Math.floor(height)}`;
  /** @type {Awaited<ReturnType<typeof httpsRequestCaptured>>|null} */
  let captured = null;
  try {
    captured = await httpsRequestCaptured({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' },
      tlsServiceId: 'utxoracle'
    });
  } catch {
    return null;
  }
  const ok = captured.statusCode >= 200 && captured.statusCode < 300;
  if (!ok) return null;
  /** @type {Record<string, unknown>} */
  let data;
  try {
    data = JSON.parse(captured.bodyBuf.toString('utf8'));
  } catch {
    return null;
  }
  if (!data || data.status === 'error' || data.height == null) return null;
  return data;
}

/**
 * Discover chain tip via Hub `/services/bitcoin/blocks/height/:n` (binary search).
 * @param {string} hubBase
 * @returns {Promise<Record<string, unknown>>}
 */
async function resolveHubChainTipBlock (hubBase) {
  const base = String(hubBase || '').replace(/\/+$/, '');
  if (!base) throw new Error('UTXOracle: hub chain fallback base URL is empty');

  const load = (h) => fetchHubBlockAtHeight(base, h);

  const genesis = await load(0);
  if (!genesis) {
    throw new Error('UTXOracle: hub chain height 0 unavailable');
  }

  let lo = 0;
  let hi = 1;
  /** @type {Record<string, unknown>|null} */
  let atHi = await load(hi);
  const MAX_EXP_HI = 1 << 24;
  while (atHi && hi < MAX_EXP_HI) {
    lo = hi;
    hi *= 2;
    atHi = await load(hi);
  }
  if (atHi && hi >= MAX_EXP_HI) {
    throw new Error(
      'UTXOracle: hub chain tip search exceeded safe height bound (hub may be misbehaving)'
    );
  }

  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await load(mid)) lo = mid;
    else hi = mid;
  }

  const tip = await load(lo);
  if (!tip) throw new Error('UTXOracle: hub chain tip block missing');
  return tip;
}

/**
 * @param {Record<string, unknown>} block
 * @param {string} chainLabel
 */
function chainTipStatsFromHubBlock (block, chainLabel) {
  const tip = Math.floor(Number(block.height));
  if (!Number.isFinite(tip) || tip < 0) {
    throw new Error('UTXOracle: hub block height invalid');
  }
  const secRaw = block.time;
  const sec = typeof secRaw === 'number' ? secRaw : Number(secRaw);
  const tipAsOfMs =
    Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0;
  const diffRaw = block.difficulty;
  const difficulty = typeof diffRaw === 'number' ? diffRaw : Number(diffRaw);
  return {
    tip,
    tipAsOfMs,
    difficulty: Number.isFinite(difficulty) ? difficulty : null,
    chain: chainLabel,
    headers: tip,
    verificationProgress: 1,
    initialBlockDownload: false,
    pruned: false,
    circulatingSupplyBtc: null,
    tipBlockOutputBtc: null
  };
}

class UTXOracle extends QuoteProvider {
  constructor (settings = {}) {
    const {
      bitcoin: bitcoinOpts = {},
      bitcoinService = null,
      chainHubFallback = null,
      ...rest
    } = settings;
    super(rest);

    this.settings = Object.assign(
      {
        enabled: false,
        windowBlocks: 144,
        currency: 'USD',
        quoteCurrency: 'USD'
      },
      this.settings
    );

    /**
     * Shared {@link Bitcoin} instance from {@link ../services/feed} when `bitcoinService` is set;
     * otherwise a dedicated client (standalone scripts).
     */
    if (bitcoinService) {
      this._bitcoin = bitcoinService;
      this._ownsBitcoinInstance = false;
    } else {
      this._ownsBitcoinInstance = true;
      /**
       * Managed node defaults; override with top-level `settings.bitcoin` / `sources.utxoracle.bitcoin`
       * (see {@link ../services/feed.js} merge). Prune size is Bitcoin Core’s minimum (MiB); keeps recent
       * blocks for the default UTXOracle window. Use `bitcoinExtraParams` for `-dbcache`, etc.
       */
      this._bitcoin = new Bitcoin(Object.assign({
        network: 'mainnet',
        managed: true,
        listen: false,
        mode: 'fabric',
        zmq: null,
        constraints: {
          storage: {
            size: 550
          }
        }
      }, bitcoinOpts));
    }

    this._bitcoinStarted = false;
    this._bitcoinStartPromise = null;

    /** @type {number|null} */
    this._lastEstimateHeight = null;
    /** @type {{ price: number, startMs: number }|null} Cached price; startMs = last-analyzed block header time (ms). */
    this._heightQuoteCache = null;
    /** @type {{ fetchedAt: number, btc: number }|null} UTXO-set circulating supply from gettxoutsetinfo (refreshed at most hourly). */
    this._circulatingSupplyCache = null;

    if (chainHubFallback === false) {
      this._chainHubFallbackEnabled = false;
      this._chainHubFallbackBaseUrl = HUB_FABRIC_CHAIN_REST_DEFAULT;
    } else if (chainHubFallback && typeof chainHubFallback === 'object') {
      this._chainHubFallbackEnabled = chainHubFallback.enabled !== false;
      const u = chainHubFallback.baseUrl != null
        ? String(chainHubFallback.baseUrl).trim().replace(/\/+$/, '')
        : '';
      this._chainHubFallbackBaseUrl = u || HUB_FABRIC_CHAIN_REST_DEFAULT;
    } else {
      this._chainHubFallbackEnabled = true;
      this._chainHubFallbackBaseUrl = HUB_FABRIC_CHAIN_REST_DEFAULT;
    }

    return this;
  }

  _rpcAdapter () {
    const b = this._bitcoin;
    return {
      call: (method, params) => b._makeRPCRequest(method, params),
      host: b.settings.host,
      port: b.settings.rpcport
    };
  }

  async _ensureBitcoin () {
    if (!this._ownsBitcoinInstance) return;
    if (this._bitcoinStarted) return;
    if (!this._bitcoinStartPromise) {
      this._bitcoinStartPromise = this._bitcoin.start().then(() => {
        this._bitcoinStarted = true;
      }).catch((err) => {
        this._bitcoinStartPromise = null;
        throw err;
      });
    }
    await this._bitcoinStartPromise;
  }

  /**
   * Sum of all vout amounts in the block (BTC). Uses {@code getblock … 2}.
   * @param {string} blockHash
   * @returns {Promise<number|null>}
   */
  async _tipBlockOutputsBtc (blockHash) {
    await this._ensureBitcoin();
    if (typeof blockHash !== 'string' || !blockHash) return null;
    const block = /** @type {{ tx?: unknown[] }} */ (
      await this._bitcoin._makeRPCRequest('getblock', [blockHash, 2])
    );
    const txs = block?.tx;
    if (!Array.isArray(txs)) return null;
    let sats = 0;
    for (let i = 0; i < txs.length; i++) {
      const outs = /** @type {{ vout?: { value?: unknown }[] }} */ (txs[i])?.vout;
      if (!Array.isArray(outs)) continue;
      for (let j = 0; j < outs.length; j++) {
        const val = outs[j]?.value;
        const n = typeof val === 'number' ? val : Number(val);
        if (Number.isFinite(n)) sats += Math.round(n * 1e8);
      }
    }
    return sats / 1e8;
  }

  /**
   * Circulating BTC from {@code gettxoutsetinfo.total_amount}. The RPC can take a long time on first
   * run; results are cached ~1 hour per {@link UTXOracle} instance.
   * @returns {Promise<number|null>}
   */
  async _circulatingSupplyBtcCached () {
    await this._ensureBitcoin();
    const TTL = 60 * 60 * 1000;
    const now = Date.now();
    const prev = this._circulatingSupplyCache;
    if (
      prev &&
      typeof prev.btc === 'number' &&
      Number.isFinite(prev.btc) &&
      now - prev.fetchedAt < TTL
    ) {
      return prev.btc;
    }
    /** @type {Record<string, unknown>} */
    const stat = /** @type {Record<string, unknown>} */ (
      await this._bitcoin._makeRPCRequest('gettxoutsetinfo', [])
    );
    const ta = stat?.total_amount;
    const btc = typeof ta === 'number' ? ta : Number(ta);
    if (!Number.isFinite(btc) || btc <= 0) {
      return prev?.btc ?? null;
    }
    this._circulatingSupplyCache = { fetchedAt: now, btc };
    return btc;
  }

  async stop () {
    if (!this._ownsBitcoinInstance) {
      this._lastEstimateHeight = null;
      this._heightQuoteCache = null;
      this._circulatingSupplyCache = null;
      return;
    }
    if (!this._bitcoinStarted) return;
    await this._bitcoin.stop();
    this._bitcoinStarted = false;
    this._bitcoinStartPromise = null;
    this._lastEstimateHeight = null;
    this._heightQuoteCache = null;
    this._circulatingSupplyCache = null;
  }

  async _currentTipHeight () {
    const n = await this._bitcoin._makeRPCRequest('getblockcount', []);
    const h = typeof n === 'number' ? n : Number(n);
    return Number.isFinite(h) ? h : null;
  }

  /**
   * Chain tip block generation time (Unix ms) for inverse-age weighting and reporting.
   * @param {number} height Non-negative chain height
   * @returns {Promise<number>}
   */
  async _blockTimeMsForHeight (height) {
    const h = Math.floor(Number(height));
    if (!Number.isFinite(h) || h < 0) {
      throw new Error('UTXOracle: invalid height for block time');
    }
    const hash = await this._bitcoin._makeRPCRequest('getblockhash', [h]);
    if (typeof hash !== 'string' || !hash) {
      throw new Error('UTXOracle: getblockhash failed');
    }
    const hdr =
      /** @type {{ time?: number }} */
      (await this._bitcoin._makeRPCRequest('getblockheader', [hash, true]));
    const sec = typeof hdr?.time === 'number' ? hdr.time : Number(hdr?.time);
    if (!Number.isFinite(sec) || sec <= 0) {
      throw new Error('UTXOracle: invalid block header time');
    }
    return Math.round(sec * 1000);
  }

  /**
   * Highest block height whose txs are included when the estimator runs with `endHeight` == chain tip
   * (`estimateUsdFromRecentBlocks` loops `start <= h < endHeight`).
   * @param {number} endHeight
   */
  _lastAnalyzedHeightForEndHeight (endHeight) {
    const e = Math.floor(Number(endHeight));
    if (!Number.isFinite(e) || e < 0) return 0;
    return Math.max(0, e - 1);
  }

  /**
   * Replay UTXOracle as if chain tip were `height` (`estimateUsdFromRecentBlocks` with `endHeight`).
   * @param {number} height
   * @returns {Promise<{
   *   height: number,
   *   analyzedThroughHeight: number,
   *   price: number,
   *   asOfMs: number,
   *   currency: string,
   *   windowBlocks: number
   * }>}
   */
  async estimateUsdAtHeight (height) {
    this.assertBtc('BTC');
    await this._ensureBitcoin();
    const h = Math.floor(Number(height));
    if (!Number.isFinite(h) || h < 0) {
      throw new Error('UTXOracle: invalid height');
    }
    const tip = await this._currentTipHeight();
    if (tip != null && h > tip) {
      throw new Error(`UTXOracle: height ${h} is above chain tip ${tip}`);
    }
    let wb =
      this.settings.windowBlocks != null ? Number(this.settings.windowBlocks) : 144;
    if (!Number.isFinite(wb) || wb < 1) wb = 144;
    const price = await estimateUsdFromRecentBlocks(this._rpcAdapter(), {
      windowBlocks: wb,
      endHeight: h
    });
    const analyzedThrough = this._lastAnalyzedHeightForEndHeight(h);
    const asOfMs = await this._blockTimeMsForHeight(analyzedThrough);
    const cur = this.settings.quoteCurrency || this.settings.currency || 'USD';
    return {
      height: h,
      analyzedThroughHeight: analyzedThrough,
      price: Number(price),
      asOfMs,
      currency: String(cur),
      windowBlocks: wb
    };
  }

  /**
   * Several replayed UTXOracle estimates from {@code minHeight} to {@code maxHeight} with uniform
   * height stepping so at most {@code maxPoints} RPC-heavy computations run, capped at
   * {@code ESTIMATE_HEIGHT_SERIES_MAX_POINTS}.
   *
   * @param {number} minHeight
   * @param {number} maxHeight
   * @param {number} [maxPoints]
   * @returns {Promise<Array<Awaited<ReturnType<UTXOracle['estimateUsdAtHeight']>>>>}
   */
  async estimateUsdHeightSeries (minHeight, maxHeight, maxPoints = 200) {
    this.assertBtc('BTC');
    await this._ensureBitcoin();
    const tip = await this._currentTipHeight();
    let min = Math.max(0, Math.floor(Number(minHeight)));
    let max = Math.floor(Number(maxHeight));
    if (tip != null && Number.isFinite(tip)) {
      max = Math.min(max, tip);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      return [];
    }
    const n = Math.max(
      1,
      Math.min(
        ESTIMATE_HEIGHT_SERIES_MAX_POINTS,
        Math.floor(Number(maxPoints)) || ESTIMATE_HEIGHT_SERIES_MAX_POINTS
      )
    );
    const span = max - min + 1;
    const step = Math.max(1, Math.ceil(span / n));
    /** @type {Awaited<ReturnType<UTXOracle['estimateUsdAtHeight']>>[]} */
    const rows = [];
    for (let h = min; h <= max; h += step) {
      rows.push(await this.estimateUsdAtHeight(h));
    }
    const last = rows[rows.length - 1];
    if (last && last.height !== max) {
      rows.push(await this.estimateUsdAtHeight(max));
    }
    const seen = new Set();
    /** @type {typeof rows} */
    const deduped = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const hi = r.height;
      if (seen.has(hi)) continue;
      seen.add(hi);
      deduped.push(r);
    }
    deduped.sort((a, b) => a.asOfMs - b.asOfMs);
    return deduped;
  }

  /**
   * Chain tip + `getblockchaininfo` fields for dashboards (HTTP report, UI card).
   */
  async chainTipStatsForReport () {
    /** @type {unknown} */
    let primaryErr;
    try {
      await this._ensureBitcoin();
      const info = /** @type {Record<string, unknown>} */ (
        await this._bitcoin._makeRPCRequest('getblockchaininfo', [])
      );
      const tip = Math.floor(Number(info.blocks));
      if (!Number.isFinite(tip) || tip < 0) {
        throw new Error('UTXOracle: invalid getblockchaininfo.blocks');
      }
      const best = info.bestblockhash;
      let tipAsOfMs = 0;
      if (typeof best === 'string' && best) {
        const hdr = /** @type {{ time?: number }} */ (
          await this._bitcoin._makeRPCRequest('getblockheader', [best, true])
        );
        const sec = typeof hdr?.time === 'number' ? hdr.time : Number(hdr?.time);
        if (Number.isFinite(sec) && sec > 0) {
          tipAsOfMs = Math.round(sec * 1000);
        }
      }
      const diffRaw = info.difficulty;
      const difficulty =
        typeof diffRaw === 'number' ? diffRaw : Number(diffRaw);
      const headersRaw = info.headers;
      const headers =
        headersRaw != null ? Math.floor(Number(headersRaw)) : tip;
      const vpRaw = info.verificationprogress;
      const verificationProgress =
        typeof vpRaw === 'number' ? vpRaw : Number(vpRaw);
      const ibdRaw = info.initialblockdownload;
      const initialBlockDownload = ibdRaw === true;

      let circulatingSupplyBtc = null;
      let tipBlockOutputBtc = null;
      if (typeof best === 'string' && best) {
        try {
          tipBlockOutputBtc = await this._tipBlockOutputsBtc(best);
        } catch {
          tipBlockOutputBtc = null;
        }
      }
      try {
        circulatingSupplyBtc = await this._circulatingSupplyBtcCached();
      } catch {
        circulatingSupplyBtc = this._circulatingSupplyCache?.btc ?? null;
      }

      return {
        tip,
        tipAsOfMs,
        difficulty: Number.isFinite(difficulty) ? difficulty : null,
        chain: typeof info.chain === 'string' ? info.chain : '',
        headers: Number.isFinite(headers) ? headers : tip,
        verificationProgress: Number.isFinite(verificationProgress)
          ? verificationProgress
          : null,
        initialBlockDownload,
        pruned: info.pruned === true,
        circulatingSupplyBtc,
        tipBlockOutputBtc
      };
    } catch (err) {
      primaryErr = err;
    }

    if (this._chainHubFallbackEnabled !== true) {
      throw primaryErr;
    }

    try {
      const tipBlock = await resolveHubChainTipBlock(
        this._chainHubFallbackBaseUrl
      );
      const host = (() => {
        try {
          return new URL(
            this._chainHubFallbackBaseUrl.startsWith('http')
              ? this._chainHubFallbackBaseUrl
              : `https://${this._chainHubFallbackBaseUrl}`
          ).host;
        } catch {
          return 'hub';
        }
      })();
      return chainTipStatsFromHubBlock(tipBlock, host);
    } catch {
      throw primaryErr;
    }
  }

  /**
   * Whether the node is caught up enough that UTXOracle’s chain-timed quote should participate in the
   * feed’s inverse-age weighted spot. During IBD, estimates use old header times and would dominate
   * the blend with huge log-ages.
   *
   * @returns {Promise<boolean>}
   */
  async isChainReadyForAggregation () {
    if (this.settings.enabled !== true) return false;
    try {
      await this._ensureBitcoin();
      const info = /** @type {Record<string, unknown>} */ (
        await this._bitcoin._makeRPCRequest('getblockchaininfo', [])
      );
      if (info.initialblockdownload === true) return false;
      const blocks = Math.floor(Number(info.blocks));
      const headers = Math.floor(Number(info.headers));
      if (!Number.isFinite(blocks) || blocks < 0) return false;
      if (Number.isFinite(headers) && headers > blocks) return false;
      const vpRaw = info.verificationprogress;
      const vp =
        typeof vpRaw === 'number' ? vpRaw : Number(vpRaw);
      if (!Number.isFinite(vp)) return false;
      /** Treat as fully verified (Core rarely reports exactly 1.0 until complete). */
      if (vp < 0.999999) return false;
      return true;
    } catch {
      return false;
    }
  }

  async getQuoteForSymbol (symbol) {
    this.assertBtc(symbol);

    await this._ensureBitcoin();

    const tip = await this._currentTipHeight();

    const heightReady =
      this._lastEstimateHeight !== null &&
      tip !== null &&
      this._lastEstimateHeight === tip &&
      this._heightQuoteCache &&
      Number.isFinite(this._heightQuoteCache.price);

    if (heightReady) {
      const q = /** @type {{ price: number, startMs: number }} */ (
        this._heightQuoteCache
      );
      const asOfMs = Math.round(q.startMs);
      const age = Math.log(Math.max(1, Date.now() - asOfMs));
      const analyzedThrough =
        this._lastEstimateHeight != null
          ? this._lastAnalyzedHeightForEndHeight(this._lastEstimateHeight)
          : undefined;
      return {
        age,
        created: new Date(asOfMs),
        currency: 'USD',
        price: q.price,
        asOfMs,
        asOfSource: 'chain',
        fromChainCache: true,
        ...(analyzedThrough != null ? { analyzedThroughHeight: analyzedThrough } : {})
      };
    }

    let usdPrice;
    try {
      usdPrice = await estimateUsdFromRecentBlocks(this._rpcAdapter(), {
        windowBlocks: this.settings.windowBlocks
      });
    } catch (e) {
      const err =
        typeof e?.message === 'string' ? e.message : JSON.stringify(e);
      throw new Error(`UTXOracle RPC: ${err}`);
    }

    const finalHeight =
      tip !== null
        ? tip
        : (await this._currentTipHeight());

    this._lastEstimateHeight =
      finalHeight !== null ? finalHeight : this._lastEstimateHeight;

    const analyzedThrough =
      finalHeight != null
        ? this._lastAnalyzedHeightForEndHeight(finalHeight)
        : 0;
    const asOfMs =
      finalHeight != null
        ? await this._blockTimeMsForHeight(analyzedThrough)
        : Math.round(Date.now());

    this._heightQuoteCache = {
      price: Number(usdPrice),
      startMs: asOfMs
    };

    const age = Math.log(Math.max(1, Date.now() - asOfMs));

    return {
      age,
      created: new Date(asOfMs),
      currency: 'USD',
      price: Number(usdPrice),
      asOfMs,
      asOfSource: 'chain',
      analyzedThroughHeight: analyzedThrough
    };
  }
}

module.exports = UTXOracle;
module.exports.ESTIMATE_HEIGHT_SERIES_MAX_POINTS = ESTIMATE_HEIGHT_SERIES_MAX_POINTS;
module.exports.estimateUsdFromRecentBlocks = estimateUsdFromRecentBlocks;
module.exports.findCentralOutput = findCentralOutput;
