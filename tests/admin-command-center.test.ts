import { test } from "node:test"
import assert from "node:assert/strict"
import {
  HEALTH_LABELS,
  appHealth,
  change,
  databaseHealth,
  emailHealth,
  isUnread,
  neverCharged,
  newMrr,
  overallHealth,
  parseRange,
  payoutWorkerHealth,
  revenueSeries,
  rithmicHealth,
  uncheckable,
  workerSyncHealth,
  type SubSpan,
} from "@/lib/admin/command-center-rules"
import { DEFAULT_ADMIN_PREFS, READ_KEYS_MAX, normalizeAdminPrefs } from "@/lib/admin/preferences"
import { BOTTOM_NAV, LEGACY_SECTIONS, NAV_GROUPS, isActive } from "@/lib/admin/nav"

// The admin command center's rules: trends, the estimated revenue history,
// what counts as healthy, which notifications are unread, the stored
// preferences, and that the new sidebar keeps every section of the old one.

const NOW = new Date("2026-10-03T12:00:00Z")
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)
const day = (iso: string) => new Date(`${iso}T08:00:00Z`)

test("change: a fraction of the previous period, or null with nothing to compare", () => {
  assert.equal(change(110, 100), 0.1)
  assert.equal(change(50, 100), -0.5)
  assert.equal(change(5, 0), null)
  assert.equal(change(0, 0), null)
})

test("parseRange: only the offered ranges, 7 days otherwise", () => {
  assert.equal(parseRange("30d"), "30d")
  assert.equal(parseRange("90d"), "90d")
  assert.equal(parseRange("365d"), "7d")
  assert.equal(parseRange(undefined), "7d")
})

test("revenueSeries: MRR per day from start and end dates, one subscription per person at the larger", () => {
  const subs: SubSpan[] = [
    { userId: "a", started: day("2026-09-28"), ended: null, monthly: 25 },
    // b upgraded on the 30th: the old one ended, the new one started — counted once each day
    { userId: "b", started: day("2026-09-27"), ended: day("2026-09-30"), monthly: 25 },
    { userId: "b", started: day("2026-09-30"), ended: null, monthly: 55 },
    // c cancelled on Oct 2: not counted at the end of Oct 2
    { userId: "c", started: day("2026-09-20"), ended: day("2026-10-02"), monthly: 41.25 },
  ]
  const s = revenueSeries(subs, 7, NOW)
  assert.equal(s.length, 7)
  assert.deepEqual(s.map((p) => p.day), ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"])
  assert.deepEqual(s.map((p) => p.mrr), [66.25, 91.25, 91.25, 121.25, 121.25, 80, 80])
  assert.deepEqual(s.map((p) => p.paying), [2, 3, 3, 3, 3, 2, 2])
})

test("neverCharged: cancelled inside the free trial; newMrr: only what started in the window and still runs", () => {
  assert.equal(neverCharged({ started: day("2026-09-01"), ended: day("2026-09-05") }, 7), true)
  assert.equal(neverCharged({ started: day("2026-09-01"), ended: day("2026-09-20") }, 7), false)
  assert.equal(neverCharged({ started: day("2026-09-01"), ended: null }, 7), false)
  const subs: SubSpan[] = [
    { userId: "a", started: day("2026-10-01"), ended: null, monthly: 25 },
    { userId: "b", started: day("2026-10-01"), ended: day("2026-10-02"), monthly: 55 },
    { userId: "c", started: day("2026-09-01"), ended: null, monthly: 55 },
  ]
  assert.equal(newMrr(subs, day("2026-09-26")), 25)
})

test("health: never 'Operational' without evidence", () => {
  assert.equal(databaseHealth({ latencyMs: null, connections: 0, maxConnections: 100 }).status, "down")
  assert.equal(databaseHealth({ latencyMs: 12, connections: 10, maxConnections: 100 }).status, "operational")
  assert.equal(databaseHealth({ latencyMs: 12, connections: 95, maxConnections: 100 }).status, "degraded")

  assert.equal(appHealth({ samples: 0, p95: null }).status, "unknown")
  assert.equal(appHealth({ samples: 40, p95: 800 }).status, "operational")
  assert.equal(appHealth({ samples: 40, p95: 2600 }).status, "degraded")

  // Rithmic: the sync clock's pulse decides
  const r = (o: Partial<Parameters<typeof rithmicHealth>[0]>) => rithmicHealth({ connections: 3, lastPass: ago(1), lastPassOk: true, runs24h: 100, failed24h: 2, ...o }, NOW).status
  assert.equal(r({}), "operational")
  assert.equal(r({ connections: 0 }), "unused")
  assert.equal(r({ lastPass: null }), "down")
  assert.equal(r({ lastPass: ago(8) }), "degraded")
  assert.equal(r({ lastPass: ago(45) }), "down")
  assert.equal(r({ lastPassOk: false }), "degraded")
  assert.equal(r({ failed24h: 60 }), "degraded")

  const mt = (o: Partial<Parameters<typeof workerSyncHealth>[0]>) => workerSyncHealth({ key: "metatrader", label: "MT4 / MT5 sync", noun: "MetaTrader", connections: 4, freshest: ago(2), failing: 0, staleMin: 15, downMin: 120, ...o }, NOW).status
  assert.equal(mt({}), "operational")
  assert.equal(mt({ connections: 0 }), "unused")
  assert.equal(mt({ freshest: null }), "down")
  assert.equal(mt({ freshest: ago(30) }), "degraded")
  assert.equal(mt({ failing: 2 }), "degraded")
  assert.equal(mt({ freshest: ago(180) }), "down")

  assert.equal(emailHealth({ configured: false, sent24h: 0, failed24h: 0, stuck: 0 }).status, "down")
  assert.equal(emailHealth({ configured: true, sent24h: 10, failed24h: 0, stuck: 0 }).status, "operational")
  assert.equal(emailHealth({ configured: true, sent24h: 10, failed24h: 1, stuck: 0 }).status, "degraded")
  assert.equal(emailHealth({ configured: true, sent24h: 0, failed24h: 3, stuck: 0 }).status, "down")

  assert.equal(payoutWorkerHealth({ lastRun: null, ok: null }, NOW).status, "unknown")
  assert.equal(payoutWorkerHealth({ lastRun: ago(2), ok: true }, NOW).status, "operational")
  assert.equal(payoutWorkerHealth({ lastRun: ago(2), ok: false, failedSteps: "sending" }, NOW).detail, "Last pass 2 min ago · failed: sending")
  assert.equal(payoutWorkerHealth({ lastRun: ago(90), ok: true }, NOW).status, "down")

  assert.equal(uncheckable("x", "X").status, "unknown")
  assert.equal(HEALTH_LABELS.down, "Unavailable")
})

test("overallHealth: the worst live check; unknown keeps 'all operational' from being claimed", () => {
  const ok = { key: "a", label: "A", status: "operational" as const, detail: "" }
  assert.equal(overallHealth([ok, { ...ok, key: "b", status: "unused" }]).label, "All systems operational")
  assert.equal(overallHealth([ok, { ...ok, key: "b", status: "unknown" }]).status, "unknown")
  assert.equal(overallHealth([ok, { ...ok, key: "b", status: "degraded" }]).status, "degraded")
  assert.equal(overallHealth([{ ...ok, status: "degraded" }, { ...ok, key: "b", status: "down" }]).status, "down")
})

test("isUnread: read one by one, or everything up to 'Mark all as read'", () => {
  const n = { key: "payout:1:pending", at: "2026-10-03T10:00:00Z" }
  assert.equal(isUnread(n, { readAt: null, readKeys: [] }), true)
  assert.equal(isUnread(n, { readAt: null, readKeys: ["payout:1:pending"] }), false)
  assert.equal(isUnread(n, { readAt: "2026-10-03T11:00:00Z", readKeys: [] }), false)
  assert.equal(isUnread({ ...n, at: "2026-10-03T11:30:00Z" }, { readAt: "2026-10-03T11:00:00Z", readKeys: [] }), true)
})

test("admin preferences: modern by default, stored values never trusted as-is", () => {
  assert.deepEqual(normalizeAdminPrefs(null), DEFAULT_ADMIN_PREFS)
  assert.equal(DEFAULT_ADMIN_PREFS.dashboard, "modern")
  const p = normalizeAdminPrefs({ dashboard: "legacy", sidebar: "collapsed", notify: { payouts: false, support: "no" }, readAt: "not a date", readKeys: ["a", "a", 7, "b", "x".repeat(200)] })
  assert.equal(p.dashboard, "legacy")
  assert.equal(p.sidebar, "collapsed")
  assert.equal(p.notify.payouts, false)
  assert.equal(p.notify.support, true) // anything but false stays on
  assert.equal(p.readAt, null)
  assert.deepEqual(p.readKeys, ["a", "b"])
  assert.equal(normalizeAdminPrefs({ dashboard: "something" }).dashboard, "modern")
  const many = normalizeAdminPrefs({ readKeys: Array.from({ length: READ_KEYS_MAX + 50 }, (_, i) => `k${i}`) })
  assert.equal(many.readKeys.length, READ_KEYS_MAX)
  assert.equal(many.readKeys.at(-1), `k${READ_KEYS_MAX + 49}`)
})

test("navigation: the new sidebar keeps every section of the old one, and adds Settings", () => {
  const modern = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
  for (const s of LEGACY_SECTIONS) assert.ok(modern.includes(s.href), `${s.label} is missing from the new sidebar`)
  assert.equal(new Set(modern).size, modern.length, "no section twice")
  assert.ok(modern.includes("/admin/settings"))
  for (const href of BOTTOM_NAV) assert.ok(modern.includes(href))
  // the same permission guards each section in both
  for (const s of LEGACY_SECTIONS) assert.deepEqual(NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === s.href)?.needs, s.needs)
  assert.equal(isActive("/admin", "/admin/users"), false)
  assert.equal(isActive("/admin/affiliates", "/admin/affiliates/payouts"), true)
  assert.equal(isActive("/admin/support", "/admin/supporters"), false)
})
