/**
 * Report on configured feeds.
 */
const Feed = require('../services/feed');
const settings = require('../settings/local');

async function main (input = {}) {
  const feed = new Feed(input);
  feed.on('debug', (msg) => console.log(msg));
  const report = await feed.generateReport();
  console.log('Feed Report:', report);
  return 1;
}

main(settings).catch((exception) => {
  console.error('Feed Error:', exception);
});
