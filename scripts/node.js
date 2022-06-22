/**
 * Run the Feed service.
 */
import * as Feed from '../services/feed.js';
import Node from '@fabric/core/types/node.js';

import * as settings from '../settings/local.js';

async function main (input = {}) {
  const node = new Node({
    service: Feed,
    settings: input
  });

  await node.start();

  return {
    id: node.id
  };
}

main(settings).catch((exception) => {
  console.error('[FEED:NODE]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FEED:NODE]', 'Main Process Output:', output);
});
