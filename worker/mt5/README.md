# MT5 sync (sync VPS)

TradeLoop syncs MetaTrader 5 accounts with its own MT5 terminals, running
headless under Wine on the sync VPS (`sync.tradeloop.pro`). No third-party
service is involved.

```
app (Vercel)                         sync VPS
─────────────                        ──────────────────────────────────────────
connect form ──► metatrader_connections (status "pending", encrypted investor password)
                        ▲   │
                        │   ▼
                        │  worker.ts (tradeloop-mt5-worker) ── claims due accounts every 2s
                        │   │                                   (lease + SKIP LOCKED)
                        │   ▼
                        │  bridge.py × N (mt5-bridge@t1, @t2) ── one MT5 terminal each,
                        │   │                                   127.0.0.1 only, token header
                        │   ▼
                        │  MetaTrader 5 terminal ── broker server
                        │   │
                        └── metatrader_deals (raw, as MT5 reported them)
                                │
/api/cron/metatrader-sync ◄─────┘ worker pings after new deals
   └─ lib/metatrader-sync.ts: deals → trades, account, journal days
```

- **Raw first.** The worker stores every deal as reported (`raw` jsonb) and
  never builds trades; `lib/metatrader-sync.ts` does that in the app. A fix to
  the trade logic can be re-run over history by clearing a connection's
  `normalizedAt`.
- **Investor password only.** It's read-only: the account can't trade through
  it. It's encrypted with `BROKER_CREDENTIALS_KEY`, which is used only by the
  app (to encrypt) and the worker (to log in).
- **Time zones.** MT5 times are broker server time. The worker compares the
  broker's live tick clock with UTC and stores `serverTimeZone` ("ny+7" or
  "fixed:<s>"; see `lib/metatrader-time.ts`). A change re-dates all trades.

## Brokers

A generic MT5 only knows the servers in its `Config\servers.dat`, and the
in-terminal broker search is a WebView2 page that doesn't render under Wine.
So each broker gets a pack: `/srv/mt5/brokers/<slug>/servers.dat`, taken from
the broker's own MT5 installer, plus an entry in
`/srv/mt5/brokers/brokers.json`:

```json
[{ "slug": "exness", "name": "Exness", "prefixes": ["Exness-"] }]
```

A bridge loads a broker's pack before serving it (`POST /reset` kills its
terminal and copies the file in; the next login starts it again). Accounts
whose server matches no prefix fail with a "not set up yet" message.

**Adding a broker:** find its MT5 installer on MetaQuotes' CDN (brokers link to
`https://download.mql5.com/cdn/web/<company-slug>/mt5/<name>5setup.exe`), then on
the VPS as `mt5` with `. /srv/mt5/env.sh; export DISPLAY=:99`:

```sh
wget -O dl/<name>5setup.exe <url>
wine dl/<name>5setup.exe /auto        # installs to C:\Program Files\MetaTrader 5 <BRAND>
mkdir -p /srv/mt5/brokers/<slug>
cp "wine/drive_c/Program Files/MetaTrader 5 <BRAND>/Config/servers.dat" /srv/mt5/brokers/<slug>/
# add { slug, name, prefixes } to brokers.json — the worker rereads it within a minute
```

## Runtime notes

- **Wine 10.0** (apt-pinned). MT5's installer refuses to run under Wine 11
  ("debugger found"). Python needs `numpy==1.26.4`: numpy 2.x calls a ucrt
  function Wine 10 lacks.
- `WINEDLLOVERRIDES=mscoree,mshtml=` everywhere, or `wineboot` hangs on an
  invisible Mono/Gecko prompt.
- A terminal that has never had an account sits in its first-run wizard and
  won't answer the Python API. The bridge therefore passes the login into
  `mt5.initialize()` on a cold start.
- MT5 updates itself and pops dialogs (LiveUpdate, wizards, crash reports) that
  can block the API. The worker closes any window that isn't a terminal's main
  window every ~10s (`wmctrl`, needs openbox).
- Services: `mt5-xvfb`, `mt5-openbox`, `mt5-wineserver` (one persistent
  wineserver, so a bridge restart doesn't take the others down),
  `mt5-bridge@t1`, `mt5-bridge@t2` (ports 9101, 9102), `tradeloop-mt5-worker`.
  Status is at `https://sync.tradeloop.pro/status/mt5`.

## Deploy

Build from a checkout with working `node_modules`:

```sh
esbuild worker/mt5/worker.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=worker.cjs --external:pg-native
scp worker.cjs root@sync:/srv/tradeloop/mt5-worker/worker.cjs
scp worker/mt5/bridge.py root@sync:/srv/mt5/wine/drive_c/mt5/bridge.py   # then chown mt5
ssh root@sync 'systemctl restart mt5-bridge@t1 mt5-bridge@t2 tradeloop-mt5-worker'
```

The worker's environment: `/etc/tradeloop/db.env` (`DATABASE_URL`, the
`tradeloop_sync` role) and `/etc/tradeloop/mt5-worker.env`
(`BROKER_CREDENTIALS_KEY`, `CRON_SECRET`, `MT5_BRIDGE_TOKEN`, `APP_URL`,
`MT5_BRIDGES`).
