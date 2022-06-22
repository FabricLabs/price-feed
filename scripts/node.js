/**
 * Run the Feed service.
 */
import Feed from '../services/feed';
import Node from '@fabric/core/types/node';

import settings from '../settings/local';

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
