# Tradovate through NinjaTrader

Tradovate only issues API access to live, funded accounts with a $1,000
minimum and a paid API add-on. Prop-firm and evaluation accounts aren't
eligible. TradeLoop therefore syncs Tradovate accounts through **NinjaTrader 8**,
which is a Tradovate-sanctioned connection. Prop firms' Tradovate accounts
(Apex, Tradeify, MyFundedFutures and others) connect to it with the trader's
own login.

NinjaTrader can run two ways, both read-only (nothing places, changes or
cancels orders) and both feeding the same pipeline (the provider-neutral
tables → `buildProviderTrades`):

- **On the VPS, with credentials — the default when it's set up.** The trader
  enters their Tradovate login in TradeLoop, like MetaTrader; NinjaTrader runs
  on the sync VPS and syncs on its own, no PC of the trader's needed. See
  "Credentials, on the VPS" below.
- **On the trader's own PC.** The trader installs a one-file add-on into their
  own NinjaTrader; it syncs while that's open. See "The add-on, on the PC".

## Credentials, on the VPS (like MetaTrader)

Enabled by setting `NINJATRADER_RELAY_SECRET` on the app and running the
NinjaTrader worker (`worker/ninjatrader`). When set, Add account → Tradovate
shows a login form instead of the add-on download.

```
Trader enters Tradovate login ─► ninjatrader_connections (password AES-256-GCM)
                                    │
worker.ts (VPS) ─ /provision (127.0.0.1) ─► provisioner ─► NinjaTrader 8 (VPS)
                                                             connection "tl-<id>"
                                                                │
                     TradeLoop add-on (relay) ─► POST /api/ninjatrader/relay
                                                                │
                                      provider_* tables ─► buildProviderTrades ─► trades
```

- **Storage.** The Tradovate password is a full credential (Tradovate has no
  read-only one), so it's AES-256-GCM encrypted (`lib/crypto`) in
  `ninjatrader_connections` — the same treatment as the Rithmic password —
  used only to log the account in through NinjaTrader on the VPS, and never
  returned to the browser. This is authorized use of an official connection,
  not an API bypass.
- **Worker** (`worker/ninjatrader/worker.ts`). Leases due logins and, over a
  127.0.0.1-only API (bearer `NINJATRADER_PROVISION_TOKEN`), hands the
  provisioner the connections to ensure in NinjaTrader (`tl-<id>`) with each
  login's username and password — decrypted in memory only, never written to
  disk. It tracks status: a login the relay has seen becomes `connected`; one
  the provisioner reports rejected becomes `reauth`; one that never connects in
  ten minutes becomes an error the trader sees.
- **Relay** (`POST /api/ninjatrader/relay`, `lib/ninjatrader/relay`). The add-on
  on the VPS posts every login's fills in one payload, keyed with the shared
  relay secret. Each account is attributed to the user who owns its NinjaTrader
  connection name (`tl-<id>`) — **only** by connection name, so two users'
  identically named accounts never cross — and stored per user through the same
  code as the PC add-on. `splitByUser` (in `relay-core`, unit-tested) does the
  attribution.
- **Provisioner + NinjaTrader.** NinjaTrader 8 on the VPS with the relay build
  of the add-on loaded (the worker writes it to `NINJATRADER_ADDON_FILE`), plus
  a helper that polls the worker's `/provision` and adds/connects the `tl-<id>`
  connections to match. NinjaTrader holds many Tradovate connections at once, so
  one instance serves every user. Setting this helper up is the VPS operator
  step — see `worker/ninjatrader/README.md`.

On the Accounts page each login is one row (like MetaTrader), showing Sync
Live / Connecting / Needs reconnect. Disconnecting clears the stored password
and the provisioner drops the connection.

## The add-on, on the PC

Where the VPS path isn't set up, the trader can run the add-on in their own
NinjaTrader. A small TradeLoop add-on, one C# file using NinjaScript (NinjaTrader's public
add-on API), reads the trader's executions inside NinjaTrader and posts them to
TradeLoop. TradeLoop builds trades from them with the same engine as every
other fill-based broker.

- **No Tradovate API.** No Tradovate password, session or cookie reaches
  TradeLoop, and nothing scrapes Tradovate.
- **Read-only.** The add-on never places, changes or cancels orders. A test
  checks that the file contains no order calls.
- **Other connections too.** Any account NinjaTrader connects works the same
  way. NinjaTrader's local simulation (Sim101, playback) is skipped. A Rithmic
  account that TradeLoop already syncs directly is skipped too, so its trades
  aren't counted twice.

```
NinjaTrader 8 (trader's PC)                      TradeLoop
  Account.ExecutionUpdate ─┐
  Account.Executions ──────┼─ TradeLoopSync.cs ── POST /api/ninjatrader/sync ──> provider_* tables
  Account.Get(CashValue…) ─┘   (Bearer sync key)     (Bearer tlnt_…)             └─> buildProviderTrades → trades
```

## For the trader

1. In NinjaTrader 8, connect the Tradovate account with the login from the
   prop firm: Connections → Configure → the **NinjaTrader** connection.
2. In TradeLoop, go to Accounts → Add account → Tradovate → **Download add-on**.
   This gives a `TradeLoopSync.cs` file with the trader's personal sync key.
3. Move the file into `Documents\NinjaTrader 8\bin\Custom\AddOns`. Then in
   NinjaTrader choose New → NinjaScript Editor and press F5, or restart
   NinjaTrader.
4. The Add account window shows the accounts as soon as the add-on checks in.
   Messages appear in New → NinjaScript Output, each starting with `[TradeLoop]`.

After that, fills reach the journal within seconds while NinjaTrader is open.
Trades placed in Tradovate's web or mobile app come in the next time
NinjaTrader connects, as long as NinjaTrader lists them under Executions.

## How it works

**Add-on** ([lib/ninjatrader/addon-source.ts](../../lib/ninjatrader/addon-source.ts)):

- It is written for C# 5, so it compiles in any NinjaTrader 8 release.
- It uses only documented NinjaScript members. Anything else (NinjaTrader's
  time-zone setting, a connection's provider name) is read by reflection with a
  fallback, so a NinjaTrader update can't break the compile.
- Sending:
  - New fills go out within about 3 s.
  - Balances and a heartbeat go out every 5 min.
  - The whole session is resent every 10 min (the server skips what it already
    has).
  - It tries one last send when NinjaTrader closes.
  - Execution times are converted from NinjaTrader's time zone to UTC.
- Error handling:
  - A failed send backs off, up to 5 min.
  - A 401 (key removed) or 403 (plan) pauses sending for an hour and prints
    why.

**Download** (`POST /api/ninjatrader/addon`): a same-origin form post for Pro
users only. It creates a key `tlnt_<32 random bytes>`. Only its SHA-256 hash is
stored, in `provider_device_keys`, along with the last 4 characters as a hint.
The key is written into the file, and the file is served once. At most 10
keys stay active; the stalest one is revoked beyond that.

**Sync** (`POST /api/ninjatrader/sync`):

- It checks the Bearer key and the Pro plan, then validates the payload
  (`parsePayload`: bounded sizes, sane times and quantities, one rejected fill
  never sinks the batch).
- It stores the data in the provider-neutral tables under one `ninjatrader`
  trading connection per user:
  - Accounts: one `provider_accounts` row per NinjaTrader account, with a
    journal account of its own. An existing journal account is never reused
    by name, so a CSV import of the same trades can't double them.
  - Executions: idempotent by `ninjatrader:desktop:<account>|<executionId>`.
    Amended fills are updated.
- Futures symbols follow Tradovate's style ("ES 12-25" becomes `ESZ5`). Point
  values come from NinjaTrader's instrument settings.
- Trades are rebuilt right after, by `buildProviderTrades`.

**Accounts page:** there is one row per account, with NinjaTrader shown as
Online or Offline, the last check-in, fills received and the last fill.
"Disconnect" stops one account. Disconnecting the last one also revokes every
add-on key.

## Tests

- `tests/ninjatrader/payload.test.ts` covers parsing, symbols, filtering,
  idempotency, trades through the engine, and keys.
- `tests/ninjatrader/addon.test.ts` generates the add-on and compiles it with
  the C# 5 compiler (`csc.exe`, on Windows). It compiles against stand-ins of
  the NinjaScript types (`stubs.cs`), then runs a simulated NinjaTrader
  session (`harness.cs`) against a local HTTP server. It checks every request
  with the server's own parser:
  - the session is sent on start and Sim101 is skipped
  - a live fill arrives within seconds
  - an account that connects later is picked up
  - times are converted from New York to UTC

The stand-ins are shaped after NinjaTrader's documented API. The first run
inside a real NinjaTrader is the final check.
