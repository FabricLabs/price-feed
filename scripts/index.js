import { createRoot } from 'react-dom/client';

import FeedMonitor from '../components/FeedMonitor';

const settings = {
  currency: 'USD',
  pollIntervalMs: 1050,
  pollFallbackIntervalMs: 30_000,
  webSocketEnabled: true,
  feedApiBase: '',
  historicalOhlcUrl: 'data/btc-usd-daily-ohlc.json'
};

async function main (input = {}) {
  const container = document.getElementById('feed');
  if (!container) {
    console.error(
      '[PORTAL:FEED] No element with id="feed" — UI will not render. Check index.html.'
    );
    return;
  }
  const root = createRoot(container);

  root.render(
    <FeedMonitor
      currency={input.currency}
      feedApiBase={input.feedApiBase}
      pollIntervalMs={input.pollIntervalMs}
      pollFallbackIntervalMs={input.pollFallbackIntervalMs}
      webSocketEnabled={input.webSocketEnabled}
      historicalOhlcUrl={input.historicalOhlcUrl}
    />
  );

  return {
    react: { root }
  };
}

main(settings).catch((exception) => {
  console.error('[PORTAL:FEED] Main Process Exception:', exception);
});
