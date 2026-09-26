import { test } from "node:test"
import assert from "node:assert/strict"
import { buildContext } from "@/lib/propmax/context"
import { evaluateAccount } from "@/lib/propmax/engine"
import { deriveAlerts, buildSnapshot } from "@/lib/propmax/alerts"
import type { PropMaxAccountView } from "@/lib/propmax/account"
import type { EngineTrade, RuleSource } from "@/lib/propmax/types"

const SOURCE: RuleSource = { name: "Test", type: "official_rules", confidence: "high", verifiedAt: "2026-09-26" }
const trade = (date: string, pnl: number): EngineTrade => ({ entryTime: `${date}T14:00:00Z`, exitTime: `${date}T15:00:00Z`, pnl, symbol: "ES", side: pnl >= 0 ? "long" : "short", quantity: 1 })
const NOW = new Date("2025-11-05T20:00:00Z")

// Worst day -1500. A tight daily-loss limit puts the rule in the danger zone.
function view(dailyLossLimit: number): PropMaxAccountView {
  const ctx = buildContext({ startingBalance: 50000, trades: [trade("2025-11-05", -1500)], now: NOW, lastSyncAt: NOW })
  const evaluation = evaluateAccount(ctx, { source: SOURCE, rules: [{ type: "max_daily_loss", unit: "currency", value: dailyLossLimit }] })
  return {
    accountId: 1,
    propAccountId: 42,
    name: "ES50K",
    broker: null,
    startingBalance: 50000,
    currency: "USD",
    brokerBalance: null,
    binding: {
      firmName: "Test Firm",
      programName: "Eval",
      phase: "evaluation",
      accountSize: 50000,
      detectionSource: "manual",
      detectionConfidence: "high",
      confirmed: true,
      status: "active",
      versionLabel: "v1",
      source: SOURCE,
      caveat: null,
    },
    evaluation,
    metrics: { balance: ctx.balance, equity: ctx.equity, highWaterMark: ctx.highWaterMark },
    detection: null,
  }
}

test("deriveAlerts fires in the danger zone with a per-day dedupe key", () => {
  const alerts = deriveAlerts(view(1800), "user_1", "2025-11-05") // 1500/1800 = 83% → warning
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].status, "warning")
  assert.equal(alerts[0].ruleType, "max_daily_loss")
  assert.equal(alerts[0].userId, "user_1")
  assert.equal(alerts[0].dedupeKey, "42:max_daily_loss:warning:2025-11-05")
  assert.match(alerts[0].title, /ES50K/)
})

test("deriveAlerts stays quiet when everything is safe", () => {
  const alerts = deriveAlerts(view(5000), "user_1", "2025-11-05") // 1500/5000 = 30% → safe
  assert.equal(alerts.length, 0)
})

test("a breach raises a breached alert", () => {
  const alerts = deriveAlerts(view(1000), "user_1", "2025-11-05") // over the limit
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].status, "breached")
  assert.equal(alerts[0].dedupeKey, "42:max_daily_loss:breached:2025-11-05")
})

test("deriveAlerts ignores an unbound account", () => {
  const v = view(1000)
  v.binding = null
  v.propAccountId = null
  assert.deepEqual(deriveAlerts(v, "user_1", "2025-11-05"), [])
})

test("buildSnapshot captures balance, risk and the full evaluation", () => {
  const snap = buildSnapshot(view(1800), "user_1", "2025-11-05")!
  assert.equal(snap.propAccountId, 42)
  assert.equal(snap.userId, "user_1")
  assert.equal(snap.date, "2025-11-05")
  assert.equal(snap.balance, "48500") // 50000 - 1500
  assert.equal(snap.riskStatus, "warning")
  assert.ok(snap.evaluation)
})
