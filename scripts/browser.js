if (!window) throw new Error('Not running in browser.  Exiting.');

// Dependencies
import * as React from 'react';
import { createRoot } from 'react-dom/client';

// Components
import FeedMonitor from '../components/FeedMonitor';

// Settings
const settings = {
  currency: 'USD',
  symbols: [
    'BTC',
    'LTC',
    'NMC'
  ]
};

// Main Process Definition
async function main (input = {}) {
  const container = document.getElementById('feed');
  const root = createRoot(container);

  root.render(<FeedMonitor state={input} />);

  return {
    react: { root }
  }
}

// Run Main Process
main(settings).catch((exception) => {
  console.error('[PORTAL:FEED] Main Process Exception:', exception);
}).then((output) => {
  console.log('[PORTAL:FEED] Main Process Output:', output);
});
