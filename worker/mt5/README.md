# MetaTrader sync (sync VPS)

TradeLoop syncs MetaTrader 5 and 4 accounts with its own terminals, running
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

## MT4

MT4 has no Python API. `bridge_mt4.py` (same HTTP contract as the MT5 bridge)
starts MT4 per sync with a one-off startup file: login, investor password,
server, and `Script=TradeLoopExport`. The script (`mql4/TradeLoopExport.mq4`,
compiled into each slot) waits for the login, writes the account's info,
history and open orders to `MQL4\Files	radeloop-<login>.json`, and closes the
terminal. The bridge deletes the startup file (it holds the password) and
`configccounts.ini` (MT4 saves the login there), and reshapes each closed MT4 order into an entry and an exit deal. From there the
worker and the app treat it like MT5. Services: `mt4-bridge@m1`,
`mt4-bridge@m2` (ports 9201, 9202; `MT4_BRIDGES` in the worker's env).

MT4 learns servers from the `.srv` files in its `config` folder and reads
every one, so one terminal serves all MT4 brokers. Current builds (1479+)
import them into an encrypted `config\servers.ini` on their next start and
delete the `.srv` files, so the bridge can't look a server up itself — the
worker checks it against `/srv/mt5/brokers/mt4-servers.json` (every `.srv`
name we've added, kept in `brokers/mt4/`) before sending an account over.

MT4's main window is titled `<login>: <server> - …`, not like MT5's, so the
worker's stray-window cleanup leaves every window of a `C:\mt4\…` process
alone (it used to close the terminal mid-export).

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

**Adding a broker** (one at a time, when users need it): find its installer
link (`https://download.mql5.com/cdn/web/<company>/mt{5,4}/<name>{5,4}setup.exe`;
the company part is the first three words of the broker's legal name), then:

```sh
sudo -u mt5 /usr/local/bin/add-broker --platform mt5 --url <url> --slug ftmo --name FTMO --prefix FTMO-
sudo -u mt5 /usr/local/bin/add-broker --platform mt4 --url <url> --slug exness --name Exness
```

The worker rereads the lists within a minute, and accounts that failed with
"not set up yet" for that broker retry on their own. **Don't script bulk downloads or
link-guessing against download.mql5.com.** MetaQuotes' CDN blocks addresses
that do (it blocked this VPS for hours once).

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
scp worker/mt5/bridge.py worker/mt5/bridge_mt4.py worker/mt5/bridge_common.py     root@sync:/srv/mt5/wine/drive_c/mt5/                                  # then chown mt5
scp worker/mt5/add_broker.py root@sync:/usr/local/bin/add-broker        # chmod 755
ssh root@sync 'systemctl restart mt5-bridge@t1 mt5-bridge@t2 mt4-bridge@m1 mt4-bridge@m2 tradeloop-mt5-worker'
```

Scripts must reach the server with LF line endings (`.gitattributes` pins
them; a CRLF `add-broker` fails with `python3: No such file or directory`).

**Set up (2026-09-26):** MT5 packs `exness`, `ftmo` (prefix `FTMO`: every
FTMO-Server/-Demo, incl. free trials); MT4 servers from FTMO (FTMO-Demo,
-Demo2, -Server…-Server4) and Exness (Exness-Real*, Exness-Trial*).

The worker's environment: `/etc/tradeloop/db.env` (`DATABASE_URL`, the
`tradeloop_sync` role) and `/etc/tradeloop/mt5-worker.env`
(`BROKER_CREDENTIALS_KEY`, `CRON_SECRET`, `MT5_BRIDGE_TOKEN`, `APP_URL`,
`MT5_BRIDGES`).
