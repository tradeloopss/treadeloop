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
3. Once listed, set `NEXT_PUBLIC_TRADELOOP_EXTENSION_URL` to the store URL — the pairing page then shows "Add to <their browser>" instead of the zip download.

## Browsers

Verified end to end (`BROWSER=chrome|brave|edge node dk/e2e-tv-extension.mjs`, 42 checks each):

| Browser | Status | Notes |
| --- | --- | --- |
| Chrome | ✅ tested | |
| Brave | ✅ tested | Shields don't interfere — the TradingView call is first-party, and the TradeLoop call carries a bearer token, no cookies |
| Edge | ✅ tested | |
| Opera, Vivaldi | ✅ expected | Same Chromium Manifest V3; installs from the Chrome Web Store |
| Firefox | ❌ not yet | Needs `background.scripts` in place of `service_worker`, a `browser_specific_settings.gecko.id`, and AMO signing (a temporary `about:debugging` load doesn't survive a restart) |
| Safari | ❌ not yet | Needs an Xcode wrapper project and an Apple developer account |

The pairing page names the browser it's open in and points at that browser's own extensions page (`brave://extensions`, `edge://extensions`, …). Brave hides itself from the user agent, so it's detected through `navigator.brave` instead.

Firefox and Safari users have the paste route, which needs nothing installed.

## Phones

Phone browsers don't run extensions, and they don't have to. TradingView's paper account is server-side, so a fill placed in the mobile app is in the same `trading/get_trades/{accountId}` history the extension reads. Any paired browser picks it up the next time it opens TradingView — one paired computer covers every device the trader uses. The e2e suite proves this: it shuts every TradingView tab, adds fills as a phone would, checks that nothing is read while no tab is open, then reopens one and checks the trade is journaled.

There is no server-side alternative. TradingView has no third-party API for paper accounts on any plan, and their login is behind Cloudflare's captcha with 2FA and IP-bound sessions, so stored credentials cannot log in at all — quite apart from what holding them would mean for accounts with a live broker attached.
