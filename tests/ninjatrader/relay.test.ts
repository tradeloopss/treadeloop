import { test } from "node:test"
import assert from "node:assert/strict"
import { checkRelaySecret, relayConfigured, relaySecret, splitByUser } from "@/lib/ninjatrader/relay-core"
import { parsePayload } from "@/lib/ninjatrader/payload"

const SECRET = "tlnt_" + "r".repeat(43)

test("relay secret: only a well-formed one configures the relay", () => {
  assert.equal(relaySecret({ NINJATRADER_RELAY_SECRET: SECRET } as unknown as NodeJS.ProcessEnv), SECRET)
  assert.equal(relaySecret({ NINJATRADER_RELAY_SECRET: "short" } as unknown as NodeJS.ProcessEnv), null)
  assert.equal(relaySecret({} as NodeJS.ProcessEnv), null)
  assert.equal(relayConfigured({ NINJATRADER_RELAY_SECRET: SECRET } as unknown as NodeJS.ProcessEnv), true)
  assert.equal(relayConfigured({} as NodeJS.ProcessEnv), false)
})

test("relay secret check is constant-time-exact and rejects mismatches", () => {
  const env = { NINJATRADER_RELAY_SECRET: SECRET } as unknown as NodeJS.ProcessEnv
  assert.equal(checkRelaySecret(SECRET, env), true)
  assert.equal(checkRelaySecret(SECRET + "x", env), false)
  assert.equal(checkRelaySecret("tlnt_" + "q".repeat(43), env), false)
  assert.equal(checkRelaySecret(null, env), false)
  assert.equal(checkRelaySecret(SECRET, {} as NodeJS.ProcessEnv), false) // not configured
})

// The core: one mixed relay payload split to the right users by connection name.
function payload() {
  const exec = (account: string, connection: string, id: string) => ({ account, id, side: "buy", qty: 1, price: 6500, time: "2025-11-03T14:30:00Z", root: "ES", expiry: "2025-12", instrumentType: "Future", pointValue: 50, connection })
  return {
    v: 1,
    client: { version: "1.0.0" },
    accounts: [
      { name: "APEX-1", connection: "tl-1", provider: "NinjaTrader", currency: "UsDollar", cashValue: 50000 },
      { name: "TPT-9", connection: "tl-2", provider: "Tradovate", currency: "UsDollar", cashValue: 25000 },
      { name: "SIM-X", connection: "tl-unknown", provider: "NinjaTrader", currency: "UsDollar", cashValue: 1 }, // no credential row
    ],
    executions: [exec("APEX-1", "tl-1", "E1"), exec("APEX-1", "tl-1", "E2"), exec("TPT-9", "tl-2", "E3"), exec("SIM-X", "tl-unknown", "E4")],
  }
}

test("attributes each account to its connection's owner, and drops unknown connections", () => {
  const r = parsePayload(payload(), new Date("2025-11-03T20:00:00Z"))
  assert.ok(r.ok)
  // tl-1 -> userA (row 1), tl-2 -> userB (row 2), tl-unknown -> nobody
  const owners: Record<string, { userId: string; rowId: number }> = { "tl-1": { userId: "userA", rowId: 1 }, "tl-2": { userId: "userB", rowId: 2 } }
  const { slices, matchedRowIds, unknownConnections } = splitByUser(r.value, (name) => owners[name.toLowerCase()] ?? null)

  assert.deepEqual(unknownConnections, ["tl-unknown"])
  assert.deepEqual(matchedRowIds.sort(), [1, 2])
  const byUser = Object.fromEntries(slices.map((s) => [s.userId, s]))
  assert.deepEqual(Object.keys(byUser).sort(), ["userA", "userB"])
  assert.deepEqual(byUser.userA.executions.map((e) => e.providerExecutionId), ["APEX-1|E1", "APEX-1|E2"])
  assert.deepEqual(byUser.userA.rowIds, [1])
  assert.deepEqual(byUser.userB.executions.map((e) => e.providerExecutionId), ["TPT-9|E3"])
  // SIM-X's fill is dropped — no owning credential row.
  assert.ok(!slices.some((s) => s.executions.some((e) => e.providerAccountId === "SIM-X")))
})

test("attribution is by connection, so identically named accounts under different logins never cross", () => {
  const dup = {
    v: 1,
    client: {},
    accounts: [
      { name: "Practice", connection: "tl-1", provider: "NinjaTrader", currency: "UsDollar" },
      { name: "Practice", connection: "tl-2", provider: "NinjaTrader", currency: "UsDollar" },
    ],
    executions: [
      { account: "Practice", connection: "tl-1", id: "A", side: "buy", qty: 1, price: 10, time: "2025-11-03T14:30:00Z", root: "ES", expiry: "2025-12", instrumentType: "Future", pointValue: 50 },
    ],
  }
  const r = parsePayload(dup, new Date("2025-11-03T20:00:00Z"))
  assert.ok(r.ok)
  // Both accounts are named "Practice" but map to different logins. Only the
  // account that actually carried the fill (via tl-1 → userA) gets it.
  const { slices } = splitByUser(r.value, (name) => (name === "tl-1" ? { userId: "userA", rowId: 1 } : name === "tl-2" ? { userId: "userB", rowId: 2 } : null))
  const a = slices.find((s) => s.userId === "userA")
  assert.equal(a?.executions.length, 1)
  // parsePayload dedupes the duplicate "Practice" account name, so userB's
  // identically named account simply carries no fills here — never userA's.
  const b = slices.find((s) => s.userId === "userB")
  assert.equal(b?.executions.length ?? 0, 0)
})

