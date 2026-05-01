'use strict';

/**
 * Replay UTXOracle USD/BTC estimate for each chain tip height using the same
 * {@link @fabric/core/services/bitcoin} RPC path as {@link ../services/utxoracle.js}.
 *
 * For end height H, estimates use blocks [max(0, H - windowBlocks), H - 1] (no block H).
 * Height 0 has no prior blocks → no estimate.
 *
 * Env (optional):
 *   UTXORACLE_WINDOW_BLOCKS — default 144
 *   UTXORACLE_FROM_HEIGHT — first endHeight (default 0)
 *   UTXORACLE_TO_HEIGHT — last endHeight inclusive (default: chain tip)
 */

const Bitcoin = require('@fabric/core/services/bitcoin');
const { estimateUsdFromRecentBlocks } = require('../services/utxoracle');
const settings = require('../settings/local');

function mergeBitcoinSettings () {
  const base = settings.bitcoin && typeof settings.bitcoin === 'object'
    ? settings.bitcoin
    : {};
  const utx = settings.sources && settings.sources.utxoracle;
  const fromUtx =
    typeof utx === 'object' && utx && typeof utx.bitcoin === 'object'
      ? utx.bitcoin
      : {};
  return Object.assign({}, base, fromUtx);
}

async function main () {
  const windowBlocks =
    process.env.UTXORACLE_WINDOW_BLOCKS != null
      ? Number(process.env.UTXORACLE_WINDOW_BLOCKS)
      : 144;

  const bitcoin = new Bitcoin(
    Object.assign(
      {
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
      },
      mergeBitcoinSettings()
    )
  );

  await bitcoin.start();

  const rpc = {
    call: (method, params) => bitcoin._makeRPCRequest(method, params),
    host: bitcoin.settings.host,
    port: bitcoin.settings.rpcport
  };

  try {
    const tipRaw = await rpc.call('getblockcount', []);
    const tip =
      typeof tipRaw === 'number' ? tipRaw : Number(tipRaw);
    if (!Number.isFinite(tip)) {
      throw new Error('getblockcount returned non-number');
    }

    const fromH =
      process.env.UTXORACLE_FROM_HEIGHT != null
        ? Math.max(0, Math.floor(Number(process.env.UTXORACLE_FROM_HEIGHT)))
        : 0;
    const toH =
      process.env.UTXORACLE_TO_HEIGHT != null
        ? Math.min(
          tip,
          Math.floor(Number(process.env.UTXORACLE_TO_HEIGHT))
        )
        : tip;

    for (let endHeight = fromH; endHeight <= toH; endHeight++) {
      if (endHeight === 0) {
        console.log('0\t(n/a: no blocks strictly before tip)');
        continue;
      }

      try {
        const price = await estimateUsdFromRecentBlocks(rpc, {
          windowBlocks,
          endHeight
        });
        console.log(`${endHeight}\t${price}`);
      } catch (err) {
        const msg =
          err && typeof err.message === 'string'
            ? err.message
            : String(err);
        console.log(`${endHeight}\t(error: ${msg})`);
      }
    }
  } finally {
    await bitcoin.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
