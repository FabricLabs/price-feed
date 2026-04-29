/**
 * Run the Feed service.
 *
 * Settings: default `settings/local.js`, or `FEED_SETTINGS=path/to/file.js` (resolved from cwd).
 *
 * **Fabric Hub / JSON-RPC:** this entrypoint runs the Feed as a Fabric `Node` program. For
 * Bridge or extension workflows that expect JSON-RPC on the same HTTP port, see
 * `@fabric/http/scripts/sample-hub-http-server.js` and enable JSON-RPC on the HTTPServer when
 * you integrate — `Feed` stays a plain REST + static bundle unless you extend it.
 */
const path = require('node:path');
const Feed = require('../services/feed');
const FeedNode = require('../services/feedNode');

const settings = require(
  process.env.FEED_SETTINGS
    ? path.resolve(process.cwd(), process.env.FEED_SETTINGS)
    : path.join(__dirname, '..', 'settings', 'local.js')
);

async function main (input = {}) {
  const node = new FeedNode({
    service: Feed,
    settings: input,
    /** Avoid an extra Fabric `Peer` (open handles) unless `settings.fabric` is configured. */
    peering: Boolean(input && input.fabric)
  });

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      console.error('[FEED:NODE] forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    console.error(`\n[FEED:NODE] ${signal} received, shutting down...`);

    try {
      if (typeof node.clearPricingReportTimers === 'function') {
        node.clearPricingReportTimers();
      }
    } catch {
      /* noop */
    }

    try {
      if (node.program && typeof node.program.stop === 'function') {
        await node.program.stop();
      }
    } catch (e) {
      console.error('[FEED:NODE] Feed.stop error:', e);
    }

    try {
      if (node.node && typeof node.node.stop === 'function') {
        await node.node.stop();
      }
    } catch (e) {
      console.error('[FEED:NODE] Fabric Peer.stop error:', e);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await node.start();

  return {
    id: node.id
  };
}

main(settings).catch((exception) => {
  console.error('[FEED:NODE]', 'Main Process Exception:', exception);
  process.exit(1);
}).then((output) => {
  if (settings.debug) {
    console.log('[FEED:NODE]', 'Main Process Output:', output);
  }
});
