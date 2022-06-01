import React from 'react';
import { createRoot } from 'react-dom/client';
import FeedMonitor from '../components/FeedMonitor';

const settings = {
  currency: 'USD',
  symbols: [
    'BTC',
    'LTC',
    'NMC'
  ]
};

async function main (input = {}) {
  const container = document.getElementById('feed');
  const root = createRoot(container);

  root.render(<FeedMonitor state={input} />);

  return {
    react: { root }
  }
}

main(settings).catch((exception) => {
  console.error('[PORTAL:FEED] Main Process Exception:', exception);
}).then((output) => {
  console.log('[PORTAL:FEED] Main Process Output:', output);
});
