// Shared constants for every part of the extension. Content scripts load this
// file first (manifest.json lists it ahead of them), the service worker
// importScripts() it, and the popup includes it with a <script> tag.
//
// scripts/build-extension.mjs rewrites the values between the markers for a
// development build that talks to a local TradeLoop and a stand-in
// TradingView; the packaged build keeps what's here.
globalThis.TRADELOOP = {
  // BEGIN build-time values
  version: "1.0.0",
  // Where fills are posted unless the pairing page says otherwise — pairing
  // on a preview deployment pairs the browser to that deployment.
  defaultBaseUrl: "https://www.tradeloop.pro",
  // TradingView's paper-trading servers. Its page picks one by the
  // account's "segment"; the free one only exists behind a TradingView
  // feature flag, so the pro host is the fallback for either.
  paperHosts: {
    pro: "https://papertrading.tradingview.com",
    free: "https://papertrading-free.tradingview.com",
  },
  tradingviewMatches: ["https://www.tradingview.com/*"],
  tradingviewUrl: "https://www.tradingview.com/chart/",
  pollSeconds: 60,
  // END build-time values

  // TradingView answers at most this many fills per account per call.
  fillsPerAccount: 1000,
  // Ids TradeLoop has confirmed storing, kept per account so later polls
  // only send what's new. Bounded so storage stays small.
  ackedIdsToKeep: 4000,
}
