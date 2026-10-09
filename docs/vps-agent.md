# TradeLoop VPS Agent

A small **read-only** Windows process deployed onto each managed VPS next to
NinjaTrader 8 and the TradeLoopSync add-on. Source: `lib/vps/agent-source.ts`
(generated per instance with the agent's device key + cloud URL baked in).

## What it does

- Heartbeats every ~30 s to `POST /api/vps/agent/heartbeat` (Bearer: the agent's
  device key), reporting `agentUp`, `ninjaTraderRunning` (a process check) and
  its version.
- Polls `GET /api/vps/agent/commands` and runs one pending command, then posts
  the result to `POST /api/vps/agent/command-result`.
- Allowed commands only: `ping`, `health`, `sync_now`, `reconcile`, `reconnect`
  (ensures NinjaTrader is running — restarts the platform, never an order),
  `collect_logs` (tails the NinjaScript log). **No trading command exists.**

## What it must not do (and does not)

It never places, changes, cancels or closes an order; it holds no broker
credential; it uses only the .NET BCL (no NinjaTrader reference, no injection,
no UI/mouse/keyboard automation). `tests/vps/agent.test.ts` asserts the source
contains no order-entry calls and compiles with `csc` standalone.

## Authentication

The agent authenticates with a `provider_device_keys` row (provider
`vps_agent`, `vpsInstanceId` set). Only the SHA-256 hash is stored; the plaintext
is injected into the VM's user-data at provisioning (`createServer`) and never
persisted or logged. Revoking the instance's agent (admin, or on destroy) stops
it at once (its next request is 401).

## Packaging & startup (real deployment)

The `.cs` is compiled on the image and installed as a Windows service with
automatic startup (`sc.exe create` / `New-Service`), so after a reboot:

```
Windows → TradeLoop VPS Agent → (ensures) NinjaTrader → add-on → broker → sync
```

Packaging as a signed service binary and configuring auto-start is part of the
provisioning image — an external/deployment step, not something the repo can
produce without the VPS + build pipeline.
