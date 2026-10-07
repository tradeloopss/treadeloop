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
  window (`wmctrl`, needs openbox) — but only one that is still there on two
  looks ten seconds apart. A terminal shows windows of its own for a moment
  while it starts, and since build 6230 (26 Sep 2026) closing one crashes it:
  that was one terminal start in three (measured 4–6 of 10; with the windows
  left alone, 0 of 10), every one a failed sync. A Wine desktop
  (`… - Wine Desktop`, the copy lane's) is never closed: closing it shuts down
  everything inside.
- **Wine's desktop can lose its owner, and then every terminal dies as it
  logs in.** The default desktop (the shared terminals' and MT4's) belongs to
  an `explorer.exe /desktop` that Wine starts by itself, as a child of
  whichever program first needed a desktop: so it lives in that program's
  service and dies when that service is restarted. Wine starts no other while
  anything is still on the desktop, and the desktop window goes on naming the
  dead owner's cursor-clip window (`__wine_x11_clip_window`). A terminal
  started after that is killed by the X server the moment it touches the clip:
  `X Error … BadWindow … X_UnmapWindow` in the bridge's journal, and
  "MetaTrader login failed: IPC recv failed" (or "send failed") for every
  account. On 7 Oct 2026 that was 36 failed syncs an hour, from a restart of
  `mt5-copy-bridge@c1`/`@c2` (their launcher had started that explorer) until
  it was found. `mend_desktop()` in `bridge_common.py` takes the dead name off
  before a terminal is started, only when the desktop has no owner. An
  `explorer /desktop` started afterwards cannot take the desktop over (it
  exits at once), so there is no service for it.
- Wine's own services (`services.exe`, `winedevice`, `plugplay`, `rpcss`) are
  started by the first program after everything was stopped, and live in that
  program's unit: `mt4-bridge@m1` since 5 Oct 2026 (`systemd-cgls` shows it).
  Restarting that one unit alone ends them under every running terminal;
  whether Wine starts them again while other programs are running has not been
  tried.
- Services: `mt5-xvfb`, `mt5-openbox`, `mt5-wineserver` (one persistent
  wineserver, so a bridge restart doesn't take the others down),
  `mt5-bridge@t1`, `mt5-bridge@t2` (ports 9101, 9102), `tradeloop-mt5-worker`.
  Status is at `https://sync.tradeloop.pro/status/mt5`.

## Copy lane

Copy Trading's own terminals (`copy-lane.ts`, unit `tradeloop-copy-lane`).
The shared terminals log in to an account, read it, and move on; a copy needs
a leader that is watched all the time and a follower whose trading session is
already open. So each copying account (`metatrader_connections.copyRole`, set
by the app for groups that are switched on) gets a terminal to itself:
`C:\mt5\c1`, `c2`, … behind `mt5-copy-bridge@c1` … on ports 9111, 9112, …
(`MT5_COPY_BRIDGES=c1:9111,c2:9112`). An account that doesn't get one keeps
working through the worker, slower.

- **One Wine desktop per terminal** (`mt5-copy-bridge.sh`): nothing done to
  another terminal's windows reaches it, and the bridge's "Algo Trading" key
  press stays inside. The bridge runs under `pythonw` there (a console window
  on such a desktop is closed by Wine, and takes the bridge with it). The
  launcher restarts a bridge that stops listening or is stuck on a dead
  terminal (`GET /alive`).
- **Watching a leader**: bridge `/watch` holds the call and answers the moment
  the positions differ from the last answer (it looks every 5ms or so), so a
  leader's trade is known within about 7ms.
- **The instant path**: the app writes each leader a plan
  (`metatrader_connections.copyPlan`, `lib/copy/plan.ts`): its groups, rules,
  followers' sizing and risk picture, good for 20 seconds and rewritten on
  every pass of the engine. With a fresh plan the lane sizes each follower's
  order itself (the app's own `decideEntry` and prop-rule guard) and sends it
  at once (`/order` with `fast`: no checks first, they run only if the session
  turns out wrong). A leader's full close closes the followers' positions the
  same way. From the leader's trade to the order leaving: about 4ms against
  pretend bridges, 14ms on the server (the calls into the terminal under Wine).
  The broker's own round trip comes on top and is the terminal's to tell
  (`sendMs`; `copyPingMs` is its ping): 125ms on the first live copy, Exness.
- **Never twice**: every such order has a name (`e:<group>:<leader ticket>:<account>`,
  `c:…` for a close) that is unique in `order_commands.clientRef`. The lane
  writes the row as it sends, and publishes the leader's new position to the
  database only after; the app's engine learns of the position from nowhere
  else (the worker leaves a held account's open positions alone), finds the
  order under its name and takes it over. An order that failed takes its row
  back first, and the engine then copies the trade its own way.
- **A crash in the middle**: each order is written to a journal file
  (`/var/lib/tradeloop/copy-lane.journal`) before it leaves, with a number of
  its own (`magic`) that MetaTrader keeps on the position. On the way back up
  the lane gives every unfinished order its row before it publishes anything,
  then reads the account: the position is there with that number (filled), or
  it is not (the row goes, and the engine copies the trade).
- Everything else — partial closes, stops and targets, a follower without a
  terminal, a trade the limits turn down, retries, Flatten All — is decided by
  the app's engine as before; the lane tells it the moment something changed
  and sends what it queues (`order_commands.broker = 'mt5c'`).
- **Who can trade here**: an account with a trading password stored is held on
  a session that can trade, whatever its role: a follower for its copies, a
  leader so that a Flatten of its own positions goes out on its own terminal.
  Without one it is held read-only. A leader whose trading password the broker
  refuses is watched read-only all the same.
- **One close per ticket**: a ticket with a close on its way, or one the
  account has been seen to close, is never sent another (a Flatten and the
  Leader's own close arrive together). What the lane remembers opening is
  trusted only until the follower's account has been read.

A terminal only helps as far as the broker is near: the round trip from this
server to Exness's access point is about 120ms, so an Exness follower can't be
confirmed faster than that whatever TradeLoop does. Closer needs a server in
the broker's own data centre.

```sh
# build and install the lane (after the app's migrations are live)
esbuild worker/mt5/copy-lane.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=copy-lane.cjs --external:pg --external:pg-native
scp copy-lane.cjs root@sync:/srv/tradeloop/mt5-worker/copy-lane.cjs
scp worker/mt5/mt5-copy-bridge.sh root@sync:/usr/local/bin/mt5-copy-bridge   # chmod 755
ssh root@sync 'systemctl restart mt5-copy-bridge@c1 mt5-copy-bridge@c2 tradeloop-copy-lane'
```

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
them; a CRLF `add-broker` fails with `python3
: No such file or directory`).

**FundingPips packs exist by the owner's decision (7 Oct 2026), against
FundingPips' own rule.** Its rules forbid reaching a trading account from a
server ("Connecting to a VPN or VPS while accessing your trading account is
not permitted"), and its support has confirmed that the investor password
changes nothing. The app connects a FundingPips account only for a trader who
has been shown that, in those words, and has ticked the box accepting the
risk (rule set v2, `cloudConnection: "own_risk"`, `lib/compliance/rules.ts`;
or the version an administrator has published at /admin/providers). Read-only:
no trading password is kept for one and no order is ever sent to one. Packs:
`fundingpips2` (prefix `FundingPips2-`, company "FundingPips Corp (2)", the
installer FundingPips' own help page links) and `fundingpips` (prefix
`FundingPips-`: -Trial, -Prime, -SIM, -SIM1), if its installer exists. If a
later version of the rules goes back to "not connected", the app stops new
connections at once; an account already connected keeps syncing until it is
disconnected, so say so to its trader.

**Set up (2026-09-26):** MT5 packs `exness`, `ftmo` (prefix `FTMO`: every
FTMO-Server/-Demo, incl. free trials), `acgmarkets` (prefixes `ACGMarkets`,
`ACG`: ACGMarkets-Main…), `fundednext` (prefix `FundedNext`: -Demo…, -Server…);
MT4 servers from FTMO (FTMO-Demo, -Demo2, -Server…-Server4), Exness
(Exness-Real*, Exness-Trial*) and FundedNext (FundedNext-Demo, -Server).

The worker's environment: `/etc/tradeloop/db.env` (`DATABASE_URL`, the
`tradeloop_sync` role) and `/etc/tradeloop/mt5-worker.env`
(`BROKER_CREDENTIALS_KEY`, `CRON_SECRET`, `MT5_BRIDGE_TOKEN`, `APP_URL`,
`MT5_BRIDGES`).
