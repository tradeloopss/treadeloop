# NinjaTrader worker (Tradovate via credentials)

Runs on the sync VPS, beside a NinjaTrader 8 install. It lets a trader connect
Tradovate by entering their login in TradeLoop — the same experience as
MetaTrader — instead of installing anything themselves. The full picture is in
[docs/integrations/ninjatrader.md](../../docs/integrations/ninjatrader.md).

```
TradeLoop (user enters Tradovate login) ─► ninjatrader_connections (encrypted)
                                              │
worker.ts ── GET /provision (127.0.0.1) ──────┤ decrypts in memory only
   ▲                                          ▼
   └── POST /report ◄── provisioner ──► NinjaTrader 8 (connection "tl-<id>")
                                              │
                       TradeLoop add-on (relay) ─► POST /api/ninjatrader/relay
```

Two pieces run on the VPS:

1. **This worker** — leases due logins, and over a **127.0.0.1-only** HTTP API
   (bearer `NINJATRADER_PROVISION_TOKEN`) tells the provisioner which
   NinjaTrader connections should exist (`tl-<id>`), with each login's
   username and password. Passwords are decrypted **only in memory** and never
   written to disk. It also tracks status: a login the relay has seen becomes
   `connected`; one the provisioner reports as rejected becomes `reauth`.
   On start it writes the relay build of the add-on to
   `NINJATRADER_ADDON_FILE`.

2. **The provisioner + NinjaTrader** — NinjaTrader 8 running on the VPS with the
   relay add-on loaded, plus a small helper that polls the worker's
   `/provision` and adds/removes/connects the `tl-<id>` connections to match,
   reporting rejected logins back to `/report`. NinjaTrader supports many
   simultaneous Tradovate connections in one instance, so one NinjaTrader
   holds every user's login. This helper is environment-specific (it drives
   NinjaTrader's connection setup) and is set up on the VPS; the worker's API
   is what it talks to.

Nothing here uses the Tradovate API. NinjaTrader↔Tradovate is a
Tradovate-sanctioned connection; the worker only stores and hands over the
login the trader gave, exactly as the MT5 worker does with its investor
passwords.

## Environment

`/etc/tradeloop/db.env` — `DATABASE_URL` (the `tradeloop_sync` role) and
`BROKER_CREDENTIALS_KEY` (to decrypt the stored passwords). Migration 0016
grants that role the `ninjatrader_connections` table.

`/etc/tradeloop/ninjatrader-worker.env`, mode 600:

```sh
APP_URL=https://www.tradeloop.pro
# Shared with the app: the add-on relay's bearer. Must be "tlnt_" + random.
NINJATRADER_RELAY_SECRET=tlnt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# The local provisioner's bearer (any long random string).
NINJATRADER_PROVISION_TOKEN=...
# Optional: NINJATRADER_PROVISION_PORT=9210,
# NINJATRADER_ADDON_FILE=/var/lib/tradeloop/TradeLoopRelay.cs
```

Set the **same** `NINJATRADER_RELAY_SECRET` in the app's environment (Vercel),
so the relay endpoint accepts the add-on's posts and the credentials path is
offered in the Add account window.

## Deploy

```sh
esbuild worker/ninjatrader/worker.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=worker.cjs --external:pg-native
ssh root@sync 'mkdir -p /srv/tradeloop/ninjatrader-worker'
scp worker.cjs root@sync:/srv/tradeloop/ninjatrader-worker/worker.cjs
scp worker/ninjatrader/tradeloop-ninjatrader-worker.service root@sync:/etc/systemd/system/
ssh root@sync 'systemctl daemon-reload && systemctl enable --now tradeloop-ninjatrader-worker'
```

The relay add-on is written to `NINJATRADER_ADDON_FILE`; load that single file
into the VPS NinjaTrader once (its `Documents\NinjaTrader 8\bin\Custom\AddOns`).

## Operating it

- **Logs:** `journalctl -u tradeloop-ninjatrader-worker -f` — JSON lines; no
  password or secret is ever logged.
- **Status:** `NINJATRADER_STATUS_FILE` lists each login's connection name and
  status, rewritten every ~15 s.
- A login shows as `connected` once its fills relay; if it never connects
  within ten minutes it flips to an error the user sees, so they can re-enter
  it. Disconnecting in TradeLoop clears the stored password and the provisioner
  removes the connection.
