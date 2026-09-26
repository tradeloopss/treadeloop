# Tradovate sync worker

Runs on the sync VPS beside the MT5 worker. It holds each connected Tradovate
login's user-data WebSocket open and runs the scheduled REST syncs; the app
turns the stored executions into journal trades. The full design, the
configuration for each mode and the production checklist are in
[docs/integrations/tradovate.md](../../docs/integrations/tradovate.md).

```
Tradovate REST ──┐
                 ├─> worker.ts ──> Postgres: trading_connections, provider_accounts,
Tradovate WS  ───┘                 provider_orders, provider_executions, provider_positions
                                   │
                                   └─> POST /api/cron/tradovate-sync ──> trades + journal
```

What each 2 s tick does:

- **Due syncs.** Claims connections with `nextSyncAt <= now()` using a
  `SKIP LOCKED` lease, at most `TRADOVATE_SYNC_CONCURRENCY` at a time (default 3),
  and runs `runTradovateSync`. That covers the first sync after OAuth, "Sync now",
  the schedule (every 10 min while the socket is live, every 2 min when it isn't)
  and the reconciliation after a reconnect.
- **Sockets.** Keeps one socket per connected login and environment (demo/live)
  that has accounts. The socket authorizes, sends one `user/syncrequest`,
  heartbeats every 2.5 s, drops after 15 s of silence and reconnects with
  exponential backoff. When it goes live again after being down, the connection
  becomes due at once, so anything missed is reconciled.
- **Tokens.** Renews access tokens about once a minute when they're within
  10 min of expiry: `renewaccesstoken` first, then the refresh token. If both
  fail, the connection is marked `reauth` and its sockets close.
- **Trades.** When new executions have arrived, it calls the app's
  `/api/cron/tradovate-sync` (Bearer `CRON_SECRET`) to rebuild trades.

Connections in `mock` mode never reach the worker; the app runs those inline.

## Environment

`/etc/tradeloop/db.env` holds `DATABASE_URL`, using the `tradeloop_sync` role
that the MT5 worker already uses. Migration 0014 grants that role the
Tradovate tables.

`/etc/tradeloop/tradovate-worker.env` holds the following, mode 600 and owned by root:

```sh
TRADOVATE_MODE=staging            # or production — must match the app
TRADOVATE_CLIENT_ID=…             # the same OAuth client as the app
TRADOVATE_CLIENT_SECRET=…         # needed to refresh tokens
BROKER_CREDENTIALS_KEY=…          # the same key as the app (decrypts tokens)
CRON_SECRET=…                     # the same secret as the app
APP_URL=https://www.tradeloop.pro
# Optional: TRADOVATE_ENVIRONMENTS=demo,live, TRADOVATE_*_URL overrides,
# TRADOVATE_SYNC_CONCURRENCY=3
```

## Deploy

Build from a checkout with working `node_modules`:

```sh
esbuild worker/tradovate/worker.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=worker.cjs --external:pg-native --external:bufferutil --external:utf-8-validate
ssh root@sync 'mkdir -p /srv/tradeloop/tradovate-worker'
scp worker.cjs root@sync:/srv/tradeloop/tradovate-worker/worker.cjs
scp worker/tradovate/tradeloop-tradovate-worker.service root@sync:/etc/systemd/system/
ssh root@sync 'systemctl daemon-reload && systemctl enable --now tradeloop-tradovate-worker'
```

Only enable the worker once Tradovate has issued the OAuth client, and use
the staging client first. With `TRADOVATE_MODE=off` it starts, logs
`worker_idle` and does nothing.

## Operating it

- **Logs:** `journalctl -u tradeloop-tradovate-worker -f`. Every line is JSON
  with an `event` (such as `ws_status`, `sync_complete`, `token_renewed`,
  `reauth_required` or `penalty_ticket`). Tokens, secrets and the `p-ticket` are
  redacted before anything is written.
- **Status:** `/var/lib/tradeloop/tradovate-status.json`, rewritten every 10 s,
  lists each connection's socket state. The app serves aggregate counts at
  `GET /api/health/tradovate`.
- **Restart:** `systemctl restart tradeloop-tradovate-worker`. Sockets reconnect
  and each one sends a fresh sync request. Leases expire after 5 min, so a sync
  killed mid-run is picked up again.
- **Rate limits:** Tradovate's penalty tickets are honoured by waiting
  `p-time` and resending with the ticket. A CAPTCHA ticket, or an HTTP 429,
  stops calls for that connection for an hour. CAPTCHAs are never automated.
