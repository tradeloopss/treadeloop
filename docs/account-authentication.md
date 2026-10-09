# Account authentication (managed VPS)

TradeLoop never stores a broker password and never automates a broker login.
There are exactly two legitimate ways a client's Tradovate account becomes
connected on the managed VPS:

1. **One-time authentication on the prepared VPS (default).** After the VPS is
   provisioned (`awaiting_auth`), the client signs into their Tradovate account
   **once, inside NinjaTrader on the managed machine** (via a guided remote
   session / RDP). NinjaTrader holds that session; TradeLoop's add-on then reads
   executions/orders/positions read-only. The password is entered only into
   NinjaTrader on the VPS — it never passes through TradeLoop's web app, is
   never stored, and is never logged.

2. **Authorized Tradovate OAuth (if/when configured).** If TradeLoop holds
   Authorized-Vendor OAuth credentials, the client authorizes via Tradovate's own
   OAuth screen and no interactive VPS step is needed. This is **not** configured
   today (`TRADOVATE_MODE=off`); it is an external vendor dependency.

## What is explicitly forbidden (and absent)

- No Tradovate/NinjaTrader password form in TradeLoop.
- No storing of broker passwords (the old credential path is disabled).
- No automated broker website login, no MFA bypass, no CAPTCHA bypass, no
  scraping, no credential stuffing, no code injection into NinjaTrader.

## Honesty

The UI never reports "broker connected" from stale or assumed data — the broker
layer is `unknown` until the add-on, through the agent, actually observes the
connection. Under the mock provider the whole flow is labelled "simulated" and
nothing is shown as connected.
