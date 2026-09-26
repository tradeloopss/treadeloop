# Tradovate through NinjaTrader (the TradeLoop add-on)

Tradovate only issues API access to live, funded accounts with a $1,000
minimum and a paid API add-on. Prop-firm and evaluation accounts aren't
eligible. TradeLoop therefore syncs Tradovate accounts through **NinjaTrader 8**,
the trader's own desktop platform. Prop firms' Tradovate accounts (Apex,
Tradeify, MyFundedFutures and others) connect to it with
the trader's own login.

A small TradeLoop add-on, one C# file using NinjaScript (NinjaTrader's public
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
