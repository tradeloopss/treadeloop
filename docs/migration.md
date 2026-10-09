# Migrating legacy local add-on users to the managed VPS

Existing users connected via the local add-on (download/pairing) keep working.
Their data is never deleted. The migration is safe and ordered:

1. The `managed_vps` feature is released (admin → beta in `/admin/features`).
   New users then see only the managed-VPS flow; existing local connections keep
   syncing.
2. For an existing user, provision a managed VPS (`POST /api/vps/provision`).
3. Verify the managed path end-to-end: VPS online, agent online, NinjaTrader
   connected, broker connected, and a successful sync (the layered health in the
   dashboard / admin shows all green, not from stale data).
4. **Only then** mark the old local connection legacy and revoke its add-on
   device key (admin: Revoke on the device). Historical `provider_executions`,
   `provider_orders`, `provider_positions` and `trades` are preserved — the
   journal is unchanged; the managed VPS simply becomes the new source of new
   fills.

Never destroy the old connection before the managed VPS is verified. Because the
whole pipeline (idempotency by `(accountId, externalId)` and
`(connectionId, idempotencyKey)`) dedupes, running both briefly during
verification cannot create duplicate trades.

## Do not

- Do not migrate broker passwords (there are none on the add-on path, and the
  managed path stores none either).
- Do not delete trading data as part of migration.
- Do not force existing users off their working connection before their managed
  VPS is confirmed healthy.
