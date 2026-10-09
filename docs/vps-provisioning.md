# VPS provisioning

How a managed Windows VPS is created and brought to "ready". See
`managed-vps-architecture.md` for the whole picture.

## The abstraction

`lib/vps/provider.ts` defines `VpsProvider`:

```
createServer / destroyServer / rebootServer
getServerState / getServerInfo / getServerHealth
```

`getVpsProvider()` picks the implementation from `VPS_PROVIDER` (default
`mock`). `vpsProviderIsReal()` tells the UI/admin whether a real provider backs
the environment, so a simulated one is always labelled and never shown as real.

- **Mock** (`lib/vps/providers/mock.ts`): development/test. Creates nothing;
  returns deterministic placeholder info (hostname `*.vps.invalid`, an RFC 5737
  `192.0.2.x` TEST-NET IP). `real = false`.
- **Real** (not yet implemented): a thin adapter over a provider API
  (create a Windows VM from a prepared image, reboot, destroy, status). Selecting
  any non-`mock` value currently throws on purpose — a real provider is an
  external dependency (account + credentials + image), not a stub to fake.

## The state machine

`lib/vps/provisioning.ts` (pure) runs these steps in order:

```
create_server → wait_for_windows → install_agent → install_ninjatrader
→ install_addon → configure_device → start_services → health_check
```

`statusForStep` maps them to the instance status (`provisioning` → `installing`
→ `configuring` → `ready`); after the last step the instance becomes
`awaiting_auth`. When the agent later observes the broker connected, it becomes
`connected`; a stale connection becomes `disconnected`.

`lib/vps/server.ts` `advanceProvisioning()` runs the provider action for the
current step then advances. Only `create_server` does real provider work in this
MVP (it mints the agent device key — hash stored, plaintext baked into the VM's
user-data via `createServer`, never persisted — and records server info). The
in-VM install/config steps are a real-provider concern (cloud-init / remote
exec / a prepared image); under the mock provider they are no-op transitions.

Under the mock provider, `GET /api/vps/status` advances one step per poll so the
simulated pipeline progresses honestly. A real provider is driven by its own
provisioning worker/agent, never by client polls.

## Choosing a real provider (engineering notes)

Requirements: Windows Server support, an API to create/destroy/reboot from a
**custom image** (NinjaTrader pre-installed), predictable per-VM cost, enough
regions, and automation-friendly credentials. Reasonable MVP candidates to
evaluate (not endorsements; verify current pricing/terms): Hetzner Cloud
(Windows via custom image), DigitalOcean (no native Windows — needs a custom
image workaround), Azure / AWS EC2 (first-class Windows, higher cost, richer
API), Vultr/Linode (Windows available). The abstraction is deliberately provider
-agnostic so the choice is a single adapter + credentials, decided when the
account exists.

**Blocked until:** a provider account, API credentials, and a Windows+NinjaTrader
image (with per-instance NinjaTrader licensing) exist. Set `VPS_PROVIDER`, add
the adapter implementing `VpsProvider`, and the rest of the pipeline is ready.
