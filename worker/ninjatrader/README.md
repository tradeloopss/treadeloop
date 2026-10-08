# NinjaTrader worker (Tradovate via credentials)

Lets a trader connect Tradovate by entering their login in TradeLoop, the same
experience as MetaTrader, instead of installing anything themselves. The full
picture is in
[docs/integrations/ninjatrader.md](../../docs/integrations/ninjatrader.md).

NinjaTrader 8 is a Windows desktop program, so it runs on a Windows server of
its own. This worker stays on the Linux sync server, where the database login
and the key that decrypts stored passwords already are, and neither leaves it.

```
TradeLoop (user enters Tradovate login) ─► ninjatrader_connections (encrypted)
                                              │
 Linux sync server                            │
   worker.ts ── 127.0.0.1:9210 ───────────────┤ decrypts in memory only
        ▲                                      
        │ SSH tunnel: one port, nothing else
        │
 Windows server                               
   NinjaTrader 8 ── TradeLoopRelay.cs
        ├─ TradeLoop Provision: GET /provision, one connection "tl-<id>" per login, POST /report
        └─ TradeLoop Sync (relay): every login's fills ─► POST /api/ninjatrader/relay
```

## The pieces

1. **This worker** (Linux). Leases due logins and, over a **127.0.0.1-only**
   HTTP API (bearer `NINJATRADER_PROVISION_TOKEN`), says which NinjaTrader
   connections should exist (`tl-<id>`), with each login's username and
   password. Passwords are decrypted **only in memory** and never written to
   disk. It tracks status: a login the relay has seen becomes `connected`; one
   reported as refused becomes `reauth`. On start it writes the server build of
   the add-on to `NINJATRADER_ADDON_FILE` (mode 600: it holds both secrets).

   - `GET /provision` → JSON, for a person or a script.
   - `GET /provision?format=lines` → one login a line for the add-on, which has
     no JSON library (`lib/ninjatrader/provision-lines.ts`).
   - `POST /report` → `{ id, status: "connected" | "reauth" | "error", message? }`.

2. **The tunnel** (Windows → Linux). A scheduled task on the Windows server
   keeps `ssh -N -L 127.0.0.1:9210:127.0.0.1:9210 nttunnel@<sync server>` open.
   The `nttunnel` account has no shell and its key is limited in
   `authorized_keys` to that one port
   (`restrict,port-forwarding,permitopen="127.0.0.1:9210"`). So the Windows
   server can ask the worker for logins, and can reach nothing else.

3. **NinjaTrader 8 with `TradeLoopRelay.cs`** (Windows). One file, two add-ons
   (`lib/ninjatrader/addon-source.ts`):
   - **TradeLoop Sync**, the same add-on a trader can run on their own PC, keyed
     with the relay secret and posting to `/api/ninjatrader/relay`.
   - **TradeLoop Provision**, which only this build has. Every 15 s it reads the
     worker's list and keeps NinjaTrader in step with it: connects a new login
     (NinjaTrader's own Tradovate connection, the one its menu calls
     "NinjaTrader"), reconnects one whose password was entered again, and
     disconnects one that was removed. A login Tradovate refuses twice running
     is reported as `reauth` and left alone until the trader enters it again.
     Connections whose name doesn't start with `tl-` are never touched. A login
     is used for its connection and nothing else: not written to a file, not
     added to NinjaTrader's saved connections, not printed.

   NinjaTrader must be signed in once with the operator's own NinjaTrader
   account (its sign-in window, at start). That is done by hand over Remote
   Desktop; nothing here knows that password.

Nothing here uses the Tradovate API. NinjaTrader↔Tradovate is a
Tradovate-sanctioned connection; the worker only stores and hands over the
login the trader gave, exactly as the MT5 worker does with its passwords.

## Environment (Linux)

`/etc/tradeloop/db.env` — `DATABASE_URL` (the `tradeloop_sync` role; migration
0016 grants it the `ninjatrader_connections` table).

`/etc/tradeloop/ninjatrader-worker.env`, mode 600:

```sh
NODE_ENV=production
APP_URL=https://www.tradeloop.pro
BROKER_CREDENTIALS_KEY=...            # to decrypt the stored passwords
# Shared with the app: the add-on relay's bearer. Must be "tlnt_" + random.
NINJATRADER_RELAY_SECRET=tlnt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# The add-on's bearer for this worker's API (any long random string).
NINJATRADER_PROVISION_TOKEN=...
# Optional: NINJATRADER_PROVISION_PORT=9210,
# NINJATRADER_ADDON_FILE=/var/lib/tradeloop/TradeLoopRelay.cs
```

Set the **same** `NINJATRADER_RELAY_SECRET` in the app's environment (Vercel),
so the relay endpoint accepts the add-on's posts. The login form in Add account
then shows to whoever the "Tradovate by login" feature is released to
(`/admin/features`: the team first, every user when it is opened).

## Deploy

Worker (Linux):

```sh
esbuild worker/ninjatrader/worker.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=worker.cjs --external:pg --external:pg-native
scp worker.cjs root@sync:/srv/tradeloop/ninjatrader-worker/worker.cjs   # node_modules/pg beside it, as for the MT5 worker
scp worker/ninjatrader/tradeloop-ninjatrader-worker.service root@sync:/etc/systemd/system/
ssh root@sync 'systemctl daemon-reload && systemctl enable --now tradeloop-ninjatrader-worker'
```

Add-on (after a worker deploy that changed it, the worker has rewritten
`NINJATRADER_ADDON_FILE`): copy it from the Linux server straight to the
Windows one, then recompile in NinjaTrader (New → NinjaScript Editor → F5) or
restart NinjaTrader.

```sh
scp -3 root@sync:/var/lib/tradeloop/TradeLoopRelay.cs \
  Administrator@windows:C:/tl/TradeLoopRelay.cs
# then, on the Windows server, move it to
#   Documents\NinjaTrader 8\bin\Custom\AddOns\TradeLoopRelay.cs
```

`C:\tl\compile.ps1 -Source <file>` on the Windows server compiles a source
against NinjaTrader's real assemblies with the C# 5 compiler: a check before
NinjaTrader is asked to.

## The Windows server

- Windows Server, a US address Tradovate answers (a blocked address gets HTTP
  403 from `live.tradovateapi.com`; check before anything else), 4 GB RAM at
  the least.
- Signs in as Administrator by itself after a restart (Sysinternals Autologon:
  the password is an LSA secret). **If that password is changed, run Autologon
  again with the new one**, or NinjaTrader won't be running after the next
  restart.
- Scheduled tasks: `TL-NinjaTrader` (starts NinjaTrader at sign-in, on the
  desktop) and `TL-Tunnel` (the tunnel, at startup, as SYSTEM;
  `C:\tl\tunnel\tunnel.log`).
- Windows updates install by themselves and restart only on Saturdays 03:00
  server time, when futures are closed.
- SSH for administration is key-only. `C:\tl` is for administrators only.

## Operating it

- **Worker logs:** `journalctl -u tradeloop-ninjatrader-worker -f` — JSON
  lines; no password or secret is ever logged.
- **Status:** `NINJATRADER_STATUS_FILE` lists each login's connection name and
  status, rewritten every ~15 s.
- **In NinjaTrader:** New → NinjaScript Output shows both add-ons' messages,
  each starting with `[TradeLoop]` (connection names only, never a login).
- A login shows as `connected` once it connects or its fills relay; if it never
  connects within ten minutes it flips to an error the user sees, so they can
  re-enter it. Disconnecting in TradeLoop clears the stored password and the
  add-on drops the connection.
