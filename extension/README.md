# TradeLoop for TradingView

A small Manifest V3 browser extension that syncs TradingView paper-trading fills into a TradeLoop journal.

TradingView's paper account lives on TradingView's servers (`papertrading.tradingview.com`) and only answers to the trader's own logged-in browser — there is no API a third party can call, on any plan. So the reading happens where it's allowed: in the trader's TradingView tab. The extension calls the same two endpoints TradingView's page calls (`trading/accounts`, `trading/get_trades/{accountId}`), with the cookies the browser already holds, and posts the fills to TradeLoop with a pairing token. Nothing of the TradingView login is read, stored or sent anywhere.

## Files

| File | Runs where | Does |
| --- | --- | --- |
| `tradingview.js` | every `www.tradingview.com` tab | polls the paper API, posts new fills to `/api/tradingview/extension` |
| `pair.js` | TradeLoop's `/extension/pair` page | reads the pairing code off the page, checks in, stores the pairing |
| `background.js` | service worker | relays "sync now", keeps the badge, nudges tabs once a minute |
| `popup.*` | toolbar popup | status, sync now, unpair, pair-with-a-code fallback |
| `config.js` | everywhere | shared constants; the build rewrites them for a dev build |

Server side: `lib/tradingview-extension.ts` (payload parsing), `lib/tradingview-extension-sync.ts` (fills → trades), `lib/tradingview-pairing.ts`, `app/api/tradingview/extension/route.ts`, `app/(app)/extension/pair/page.tsx`.

## Building

```sh
node scripts/build-extension.mjs
```

writes `public/extension/tradeloop-tradingview.zip`, which the pairing page offers for download with "Load unpacked" instructions. Rebuild and commit the zip whenever anything in `extension/` changes.

A development build that talks to a local TradeLoop and a stand-in TradingView (the e2e test runs one):

```sh
node scripts/build-extension.mjs --dev --out .extension-dev --base http://localhost:3000 --tv http://127.0.0.1:3702 --poll 4
```

## Publishing to the Chrome Web Store

1. Bump `version` in `manifest.json`, rebuild the zip.
2. Upload the zip at https://chrome.google.com/webstore/devconsole (one-time $5 developer registration). Category: Productivity. The permissions to justify: `storage` (the pairing token and sync status), `alarms` (the once-a-minute nudge), host access to `www.tradingview.com` (where the fills are read) and `www.tradeloop.pro` (where they're posted and where pairing happens).
3. Once listed, set `NEXT_PUBLIC_TRADELOOP_EXTENSION_URL` to the store URL — the pairing page then shows "Add to Chrome" instead of the zip download.

Edge and Brave install Chrome Web Store extensions directly. Firefox needs a signed build (AMO) and `background.scripts` in place of `service_worker`; not done yet.
