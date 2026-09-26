# Tradovate integration

> **Without Tradovate API access** (Tradovate requires a live, funded account
> with $1,000 or more and a paid API add-on, and prop-firm accounts aren't
> eligible), Tradovate accounts sync through NinjaTrader 8 and the TradeLoop
> add-on. See [ninjatrader.md](ninjatrader.md). That's what the Add account
> window offers while `TRADOVATE_MODE` is `off`. The OAuth integration below
> takes over once Tradovate approves TradeLoop as a partner.

TradeLoop connects to Tradovate through Tradovate's official Partner API
only: OAuth sign-in, the documented REST endpoints and the user-data
WebSocket. It reads accounts, balances, orders, fills, fill fees and
positions. It never places, changes or cancels orders, never sees a
Tradovate password, and uses no scraping, private endpoints or browser
cookies.

## Architecture

```
Browser ──POST /api/integrations/tradovate/connect──> app ──303──> Tradovate sign-in page
Browser <──303 /accounts?tradovate=<id>── app <──GET …/callback?code&state── Tradovate
                                          │ exchange code → tokens (encrypted) → trading_connections
                                          ▼
Sync VPS worker (worker/tradovate) ── REST sync + reconciliation ──> provider_* tables
                                   ── WebSocket (per login, per env) ─┘
                                   └─ POST /api/cron/tradovate-sync ──> app: trades + journal
```

| Layer | Files |
| --- | --- |
| Provider-neutral model | `lib/providers/types.ts` (`TradingProvider`, normalized account/order/execution/position, `ProviderError`), `lib/providers/idempotency.ts` |
| Tradovate client | `lib/tradovate/config.ts`, `http.ts` (retries, penalty tickets, 429), `oauth.ts`, `state.ts`, `api.ts`, `protocol.ts`, `realtime.ts`, `instruments.ts`, `normalize.ts`, `mock.ts`, `log.ts`, `provider.ts` |
| Sync engine | `lib/tradovate/sync.ts` (tokens, REST sync, reconciliation, realtime ingestion) |
| Trades | `lib/tradovate/fills.ts` (pure) + `lib/tradovate/trades.ts` (DB), both using the shared engine in `lib/fill-reconstruction.ts` |
| App surface | `lib/tradovate/connections.ts`, `app/actions/tradovate.ts`, `app/api/integrations/tradovate/*`, `app/api/cron/tradovate-sync`, `app/api/health/tradovate` |
| UI | `components/accounts/tradovate-connect.tsx`, `add-account-modal.tsx`, `accounts-list.tsx`, `app/(app)/accounts/page.tsx` |
| Worker | `worker/tradovate/worker.ts`, `tradeloop-tradovate-worker.service`, `README.md` |
| Database | `drizzle/0014_trading_connections.sql`, `lib/db/schema.ts` |
| Tests | `tests/tradovate/*.test.ts` (`pnpm test`) |

Rithmic, MetaTrader and TradingView keep their own tables and code. The
`trading_connections` / `provider_*` tables and the `TradingProvider`
interface are provider-neutral, so those integrations can move onto them
later without another schema change.

### Data model

| Table | One row per | Key |
| --- | --- | --- |
| `trading_connections` | Tradovate login connected by a TradeLoop user | unique (userId, provider, environment, providerUserId) |
| `provider_accounts` | Tradovate account under that login (demo or live) | unique (connectionId, environment, providerAccountId); `tradingAccountId` links the journal account |
| `provider_orders` | order | unique (connectionId, environment, providerOrderId) |
| `provider_executions` | fill, with its fees and point value | unique (connectionId, idempotencyKey) |
| `provider_positions` | open position | unique (connectionId, environment, providerAccountId, contractId) |

A connection also stores its encrypted tokens and their expiries, a status
(`pending`, `connected`, `reauth`, `error` or `disconnected`) and the
`syncStage` that drives the progress screen. It also records the realtime
socket state, the last event and reconciliation times, a lease for the
worker and `tradesDirtyAt`, which says new executions still need building
into trades. Every table has RLS, and the sync worker's `tradeloop_sync`
role is granted only what it needs.

### Connect flow

1. **Add account → Tradovate → Connect Tradovate** POSTs
   `/api/integrations/tradovate/connect`. This needs a same-origin request,
   a signed-in user and the Pro plan. The route creates a random `state`
   and sets it in an encrypted, httpOnly, SameSite=Lax cookie, bound to the
   user, that lasts 10 minutes. It then redirects to Tradovate's sign-in
   page.
2. Tradovate redirects to `/api/integrations/tradovate/callback?code&state`.
   The callback verifies the state (constant-time comparison, expiry,
   same user), exchanges the code server-side, reads `/auth/me` and upserts
   the connection. The connection starts as `pending` and due now. The
   callback then redirects to `/accounts?tradovate=<id>`.
3. The Add account window reopens on the progress view, which polls
   `getTradovateConnection`. It steps through Authenticated, Finding
   accounts…, Importing orders…, Importing executions…, Building trades…,
   Calculating P&L… and Sync complete, and shows retry or reconnect on
   failure.
4. Every Tradovate account becomes a journal account named
   "Tradovate - <name>". Each one can be disconnected on its own;
   disconnecting the last one deletes the saved tokens.

### Sync, realtime and reconciliation

- **REST sync** (`runTradovateSync`) runs per environment. It lists
  accounts and cash balances, then orders, fills and fill fees, then
  positions, and resolves each instrument through contract → contractMaturity
  → product. That gives the symbol, the contract month and the point value
  (`valuePerPoint`); nothing is hard-coded. A fill has no account id, so it
  is attributed through its order. Unknown orders are looked up, and a fill
  that still can't be attributed is held back rather than guessed.
- **Idempotency.** An execution is stored under
  `tradovate:<env>:<fillId>` (or a hash of its identity when there's no id)
  with `ON CONFLICT DO NOTHING`. A fill delivered twice, by REST and the
  socket or across reconnects, is stored once. Busted fills
  (`active=false`) stay stored but never make a trade.
- **Realtime.** There is one socket per login and environment. It
  authorizes, sends one `user/syncrequest` with entity types, heartbeats
  (`[]`) every 2.5 s, treats 15 s of silence as a dead socket and
  reconnects with exponential backoff and jitter. Fill, order, position,
  cash-balance and account events are stored as they arrive.
- **Reconciliation.** Every REST sync is also a reconciliation: remote
  execution ids are compared with stored ones, and missing ones are
  inserted. The counts go into `lastReconcileSummary`. It runs every
  10 min while the socket is live and every 2 min while it isn't. It also
  runs at once after a reconnect, which covers anything missed while the
  socket was down. Users can trigger it with "Sync now", or through
  `POST /api/integrations/tradovate/reconcile`.
- **Trades.** The app rebuilds trades with the engine every fill-based
  broker uses: flat to flat, average-cost entry and exit, with each fill's
  fees added to its trade (a flip splits its fee by quantity). P&L is
  (exit − entry) × quantity × point value − fees. The `externalId` comes
  from the closing fill, so a rebuild is idempotent. Late fees update
  their trade, and a busted fill removes it. Journal days are regenerated
  and the account size is inferred as for the other brokers.
- **Prop firms.** Accounts are stored exactly as Tradovate reports them.
  TradeLoop doesn't derive drawdown, targets or other firm rules from
  Tradovate data. The existing prop-firm features apply to the journal
  account the same way they do for other brokers.

### Errors and limits

| Condition | Handling |
| --- | --- |
| Penalty ticket (`p-ticket`, `p-time`) | wait `p-time`, resend with the ticket; after 3, back off |
| `p-captcha` | stop; never automated; retry after an hour |
| HTTP 429 | no calls for an hour (retrying resets Tradovate's clock) |
| 401 | renew (`/auth/renewaccesstoken`), else refresh token, else status `reauth` → Reconnect in the UI |
| 403 / 404 on an environment | that environment is skipped (e.g. no live accounts) |
| 5xx / network | exponential backoff with jitter, then the next scheduled sync |
| WebSocket drop, close frame, shutdown, silence | reconnect with backoff; reconciliation after it's live again |

## API routes

All routes need a signed-in session. The POST routes also check the origin.
None of them returns tokens.

| Route | |
| --- | --- |
| `POST /api/integrations/tradovate/connect` | start OAuth (form POST, 303) |
| `GET  /api/integrations/tradovate/callback` | OAuth redirect target |
| `GET  /api/integrations/tradovate/status` | the user's connections, statuses, socket state |
| `GET  /api/integrations/tradovate/accounts` | accounts with balances |
| `GET  /api/integrations/tradovate/accounts/:id?include=positions,orders,executions&limit=` | one account's detail |
| `POST /api/integrations/tradovate/sync` | `{connectionId}` — sync now |
| `POST /api/integrations/tradovate/reconcile` | `{connectionId}` — queue a reconciliation now |
| `POST /api/integrations/tradovate/disconnect` | `{connectionId}` — deletes tokens, stops sync |
| `POST /api/cron/tradovate-sync` | Bearer `CRON_SECRET` — build trades (called by the worker) |
| `GET  /api/health/tradovate` | aggregate counts by status and socket state only |

## Configuration

All variables are listed in `.env.example`. The mode is set by
`TRADOVATE_MODE`:

- **`off`** (the default). Tradovate shows as "Coming soon" and nothing runs.
- **`mock`** (development). Fixture data, no network: two demo accounts
  and one live account, with a duplicated fill and a busted fill. The sync
  runs inline in the app. It is refused when `NODE_ENV` or `VERCEL_ENV` is
  `production`. It still writes real rows (journal accounts named
  "Tradovate - APEX-50K-0001" and so on) to whatever database
  `DATABASE_URL` points at, so only use it against a development
  database.
- **`staging`**. Tradovate/NinjaTrader's partner staging hosts
  (`demo-api.staging.ninjatrader.dev` and `live-api.staging.ninjatrader.dev`).
- **`production`**. `demo.tradovateapi.com` and `live.tradovateapi.com`,
  with sign-in at `https://trader.tradovate.com/oauth`.

### Staging

On a Vercel Preview (or a separate project) and on the worker:

```sh
TRADOVATE_MODE=staging
TRADOVATE_CLIENT_ID=<staging client id>
TRADOVATE_CLIENT_SECRET=<staging client secret>
TRADOVATE_OAUTH_AUTHORIZE_URL=<staging sign-in URL from Tradovate>
APP_URL=https://<the preview host>     # or TRADOVATE_REDIRECT_URI explicitly
```

Register `https://<host>/api/integrations/tradovate/callback` as the
redirect URI with Tradovate; it has to match exactly.

### Production

```sh
TRADOVATE_MODE=production
TRADOVATE_CLIENT_ID=<production client id>
TRADOVATE_CLIENT_SECRET=<production client secret>
APP_URL=https://www.tradeloop.pro
```

Set these in Vercel (Production) and in `/etc/tradeloop/tradovate-worker.env`,
redeploy, then enable the worker (below). `TRADOVATE_ENVIRONMENTS=demo` limits
syncing to demo/sim accounts if needed.

## Deployment

1. **Database.** Migration 0014 is applied by `scripts/migrate.mjs` on the
   next Vercel build.
2. **App.** Set the environment variables above and deploy.
3. **Worker.** Follow `worker/tradovate/README.md`: build with esbuild,
   copy it to `/srv/tradeloop/tradovate-worker/`, install the systemd
   unit, write `/etc/tradeloop/tradovate-worker.env`, then
   `systemctl enable --now tradeloop-tradovate-worker`. It reuses
   `/etc/tradeloop/db.env`.
4. **Verify.**
   - `journalctl -u tradeloop-tradovate-worker` should show `worker_starting`
     and then `ws_status … live` for each connection.
   - `GET /api/health/tradovate` gives the aggregate counts.
   - The connection's Accounts row shows Realtime Live and a recent
     reconciliation.

## Security

- **Passwords.** The Tradovate password is typed only on Tradovate's page.
  TradeLoop has no field for it and never stores one.
- **Tokens.** Access and refresh tokens are encrypted with AES-256-GCM
  (`BROKER_CREDENTIALS_KEY`) in `trading_connections`. They are never
  returned by an action or route, never sent to the browser and never put
  in localStorage. Disconnecting deletes them.
- **Client secret.** It is read only on the server and sent only to
  Tradovate's token endpoint.
- **OAuth state.** It is encrypted, httpOnly, user-bound and expires after
  10 minutes, and is checked in constant time. The POST routes check the
  request origin.
- **Logs.** They are JSON lines (`lib/tradovate/log.ts`). Keys that look
  like tokens, secrets, passwords, cookies, authorization headers or
  p-tickets are dropped at any depth, and `Bearer …` values are masked.
- **Database.** RLS is on for every table. The VPS worker connects as
  `tradeloop_sync` with only the grants it needs.
- **Access.** TradeLoop only reads. `lib/tradovate/api.ts` contains no
  order-entry endpoints.
- **Mock data.** Mock mode is refused on production, so fixture trades
  can't reach real journals.

## Tests

`pnpm test` runs 51 tests with no network. They cover:

- the protocol and HTTP handling: penalty tickets, captcha, 429, 401 and
  5xx retry
- OAuth and state: the exchange, renewal, refresh and reauth; tampered,
  expired or wrong-user state; and log redaction
- normalization: multiple accounts, fees, busted fills, unattributed fills
  and idempotency keys
- the trade engine: the ES example ($650 gross), fee splitting on a flip,
  de-duplication and a mock end-to-end sync with stable externalIds
- reconciliation of late trades
- the WebSocket, driven by fake sockets and timers: authorize, a single
  syncrequest, 2.5 s heartbeats, the silence rule, backoff, re-authorizing
  with a renewed token, and close

## What Tradovate still has to provide for production

TradeLoop's side is built. Moving from staging to production needs these
from Tradovate/NinjaTrader:

1. **Partner API access.** The partner agreement, and an OAuth client for
   TradeLoop.
2. **Staging credentials.** A staging client id and secret, the staging
   sign-in (authorize) URL, and the registered redirect URI. With these,
   the flow can be run end to end on staging.
3. **Conformance testing.** Tradovate certifies partners in stages:
   1 Authentication, 2 WebSocket, 3 User management, 4 Account management
   and 5 Market data. TradeLoop implements what stages 1–2 check (OAuth,
   token renewal, penalty tickets, the one-syncrequest rule, heartbeats and
   reconnects). Stages 3–5 cover operator features (user and account
   administration, market data) that a read-only journal doesn't use.
   Confirm with Tradovate's solutions engineering team which stages apply
   to this integration.
4. **Submission.** Compile the test results, submit them to solutions
   engineering, receive certification, then receive the production client
   id and secret.
5. **Requirements on the user's side.** Confirm with Tradovate whether end
   users need anything enabled to authorize a partner app. The integration
   doesn't assume either way. If Tradovate refuses a user, the connection
   shows Tradovate's reason (a 403 is shown as "Tradovate refused this
   request for your account").
