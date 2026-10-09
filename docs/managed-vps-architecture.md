# Managed Windows VPS for NinjaTrader

The one production architecture for connecting Tradovate/NinjaTrader:

```
CLIENT → TradeLoop web app → Managed Windows VPS → NinjaTrader 8
       → TradeLoopSync add-on → Tradovate → TradeLoop cloud
       → orders / executions / positions / journal
```

The client installs nothing locally. NinjaTrader and the add-on run on a
TradeLoop-managed Windows VPS. **Read-only throughout** — TradeLoop never places,
changes, cancels or closes an order — and **no broker password is ever stored**:
the client authenticates their account once inside NinjaTrader on the prepared
VPS (or through an authorized OAuth flow if/when one is configured).

This document is the hub; see `vps-provisioning.md`, `vps-agent.md`,
`account-authentication.md`, and `migration.md`.

## What was already here (reused, not rebuilt)

The cloud ingestion + journal half already existed and is reused unchanged: the
provider-neutral tables (`trading_connections`, `provider_accounts`,
`provider_orders`, `provider_executions`, `provider_positions`), device-key auth
(`provider_device_keys`), `/api/ninjatrader/sync` + `/api/ninjatrader/relay`,
`reconstructTrades` / `buildProviderTrades`, reconciliation, heartbeat, Pro
gating, and the admin NinjaTrader monitoring. A single operator Windows server +
the Provision add-on + the Linux worker already proved the "NinjaTrader on a
managed machine" shape — but that path auto-logs-in from a **stored password**
and is therefore disabled (see below).

## What was added (this implementation)

- **`vps_instances`** + **`vps_agent_commands`** tables (migration `0053`) and a
  `vpsInstanceId` link on `provider_device_keys`.
- **`VpsProvider` abstraction** (`lib/vps/provider.ts`) + a **mock/dev provider**
  (`lib/vps/providers/mock.ts`). The mock creates nothing real and is labelled
  "simulated" everywhere; production sets `VPS_PROVIDER` to a real provider.
- **Provisioning state machine** (`lib/vps/provisioning.ts`, pure) and the DB
  service (`lib/vps/server.ts`) that runs the provider and advances it.
- **Layered health** (`lib/vps/health.ts`, pure): VPS / agent / NinjaTrader /
  broker / TradeLoop, each `online | offline | unknown` — never a false
  "connected".
- **TradeLoop VPS Agent** (`lib/vps/agent-source.ts`): a read-only C# Windows
  process that heartbeats, reports process health and runs only safe commands
  (ping, health, sync_now, reconcile, reconnect, collect_logs). Compiles with
  `csc`; packaged as a service by provisioning (`vps-agent.md`).
- **APIs**: `POST /api/vps/provision`, `GET /api/vps/status`,
  `POST /api/vps/reconnect`, `POST /api/vps/reconcile`, and the agent channel
  `POST /api/vps/agent/heartbeat`, `GET /api/vps/agent/commands`,
  `POST /api/vps/agent/command-result`. Admin actions in
  `app/actions/admin-vps.ts`.
- **Client UI** `components/accounts/managed-vps-connect.tsx` and **admin UI**
  (Managed VPS instances panel in `/admin/ninjatrader`).
- **Feature flag** `managed_vps` (default **admin test only**). While off, the
  existing add-on flow is unchanged; when released, the managed flow becomes the
  **only** Tradovate option (local add-on download/pairing, credential login and
  OAuth bodies are all hidden). This ordering means no client is ever left
  without a working connection path.

## Authentication (no stored password)

"Fully hands-off" and "no stored password" cannot both hold unless Tradovate
OAuth is configured. So the sanctioned flow is: the client authenticates **once**
inside NinjaTrader on the prepared VPS; after that TradeLoop operates the VPS and
the add-on reads executions/orders/positions read-only. TradeLoop never shows a
Tradovate password form, never stores a broker password, and never automates a
broker login. See `account-authentication.md`.

## Disabled paths (kept for reference only)

- **VPS credential login** (`lib/ninjatrader/credentials.ts`, `ninjatrader_connections`): stores an encrypted Tradovate password to auto-login on the operator server. **Disabled** — `ninjaVps: false` in `accounts-section.tsx`, behind the `tradovate_vps` flag and `NINJATRADER_RELAY_SECRET`. Not revived.
- **Direct Tradovate OAuth** (`lib/tradovate/*`, `TRADOVATE_MODE`): dormant, `off` by default; not a client-selectable method.
- **Local add-on download / pairing** (`/api/ninjatrader/addon`, `/connect`): legacy; hidden from new users once `managed_vps` is released. Existing users keep working until migrated (`migration.md`).

## Read-only guarantee

No order-entry path exists. The add-on and the agent are both checked by tests
(`tests/ninjatrader/addon.test.ts`, `tests/vps/agent.test.ts`) to contain no
`SubmitOrder`/`CancelOrder`/`ChangeOrder`/`ClosePosition`/`Enter*`/`Exit*`/
`CreateOrder`/`AtmStrategy` and no `.Submit(`/`.Cancel(`/`.Change(`/`.Flatten(`.
Agent commands are an allow-list of read-only operations.

## Cost (one VPS per client)

| Clients | Always-on Windows VMs | Rough infra €/$ per month* |
|--------:|----------------------:|----------------------------:|
| 10 | 10 | ~$200–600 |
| 50 | 50 | ~$1,000–3,000 |
| 100 | 100 | ~$2,000–6,000 |
| 500 | 500 | ~$10,000–30,000 |

\*VM only (~$20–60/VM/mo depending on provider/size), **excluding** NinjaTrader
licensing per instance and Windows licensing. This is a recurring operating cost
the business must accept; the code never creates billable infrastructure without
real provider credentials.

## External blockers (genuinely cannot be done from the repo)

1. **Cloud VPS provider account + API credentials** → real provisioning. Until set, `VPS_PROVIDER=mock` and nothing real is created.
2. **A Windows + NinjaTrader image** (and per-instance NinjaTrader license) to provision.
3. **Tradovate OAuth Authorized-Vendor credentials** → the only hands-off auth; otherwise one-time client auth on the VPS.
4. **Compliance/ToS confirmation** (legal): NinjaTrader license for operator-hosted/multi-instance use; each prop firm's terms on server-side account access (FundingPips forbids server access; firms vary); Windows + VPS-provider terms. See `lib/compliance`.

Everything that does not require these is implemented and tested.
