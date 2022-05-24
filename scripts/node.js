/**
 * Run the Feed service.
 */
const Feed = require('../services/feed');
const Node = require('@fabric/core/types/node');

const settings = require('../settings/local');

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
