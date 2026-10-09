import { test } from "node:test"
import assert from "node:assert/strict"
import { NAV_SECTIONS, itemForPath, resolveNavigation, sectionForPath, type NavContext } from "@/lib/navigation"

// The main navigation: seven product areas, every page that existed before the
// redesign still reachable, and what isn't released impossible to open.

const user: NavContext = { isAdmin: false, isPro: true, hasBeta: false, features: {} }
const admin: NavContext = { isAdmin: true, isPro: true, hasBeta: false, features: { edge_lab: "admin", psychology: "admin", copy_trading: "admin" } }
const items = (ctx: NavContext) => resolveNavigation(ctx).flatMap((s) => s.items)
const byId = (ctx: NavContext, id: string) => items(ctx).find((i) => i.id === id)!

test("the seven product areas, in order", () => {
  assert.deepEqual(NAV_SECTIONS.map((s) => s.label), ["Journal", "Account Manager", "PropSync", "Edge Lab", "Copy Trading", "Backtesting", "Agents"])
  assert.deepEqual(NAV_SECTIONS[0].items.map((i) => i.label), ["Dashboard", "Journal", "Trades", "Calendar", "Reports", "Playbooks"])
  assert.equal(NAV_SECTIONS[0].action?.href, "/add-trade")
  assert.deepEqual(NAV_SECTIONS[3].items.map((i) => i.label), ["Edge Overview", "Edge Discovery", "Psychology", "Edge Journal", "Edge Tests"])
})

test("every page of the old sidebar is still in the menu, at the same address", () => {
  const hrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
  for (const old of ["/dashboard", "/trades", "/journal", "/calendar", "/trade-manager", "/playbooks", "/reports", "/propfirm", "/propfirm-max", "/payouts", "/backtest", "/replay", "/edge-lab", "/psychology"]) assert.ok(hrefs.includes(old), old)
  // no page is listed twice
  const real = hrefs.filter(Boolean)
  assert.equal(new Set(real).size, real.length)
})

test("the product area follows the address", () => {
  const cases: [string, string | null][] = [
    ["/dashboard", "journal"],
    ["/trades", "journal"],
    ["/calendar", "journal"],
    ["/add-trade", "journal"],
    ["/trade-manager", "account-manager"],
    ["/propfirm", "propsync"],
    ["/propfirm-max", "propsync"],
    ["/payouts", "propsync"],
    ["/edge-lab", "edge-lab"],
    ["/edge-lab/discover", "edge-lab"],
    ["/edge-lab/robustness", "edge-lab"],
    ["/psychology", "edge-lab"],
    ["/psychology/patterns", "edge-lab"],
    ["/backtest", "backtesting"],
    ["/backtest/12", "backtesting"],
    ["/replay", "backtesting"],
    ["/settings", null],
    ["/billing", null],
  ]
  for (const [path, section] of cases) assert.equal(sectionForPath(path), section, path)
})

test("the page follows the address, the most specific entry winning", () => {
  const id = (path: string) => itemForPath(path)?.item.id ?? null
  assert.equal(id("/edge-lab"), "edge-overview")
  assert.equal(id("/edge-lab/discover"), "edge-discovery")
  assert.equal(id("/edge-lab/regimes"), "edge-discovery")
  assert.equal(id("/edge-lab/setups"), "edge-journal")
  assert.equal(id("/edge-lab/monitor"), "edge-journal")
  assert.equal(id("/edge-lab/hypotheses"), "edge-tests")
  assert.equal(id("/edge-lab/robustness"), "edge-tests")
  assert.equal(id("/psychology/review"), "psychology")
  assert.equal(id("/propfirm"), "prop-firm")
  assert.equal(id("/propfirm-max"), "propsync-tracker") // not mistaken for Prop Firm
  assert.equal(id("/trades"), "trades")
  assert.equal(id("/trade-manager"), "trade-manager")
  assert.equal(id("/settings"), null)
})

test("what isn't released can't be opened by a user", () => {
  for (const id of ["copy-cockpit", "propsync-tracker", "backtesting", "replay", "agents"]) {
    const item = byId(user, id)
    assert.equal(item.enabled, false, id)
    assert.equal(item.badge, "soon", id)
  }
  // the Agents area as a whole is closed; the others open to show their pages
  const sections = resolveNavigation(user)
  assert.deepEqual(sections.filter((s) => !s.enabled).map((s) => s.id), ["agents"])
  // a page with no address is closed to everyone, the team included
  assert.equal(byId(admin, "agents").enabled, false)
  // Copy Trading is its own product area below Edge Lab; its five pages follow the copy_trading release stage
  const copy = resolveNavigation(admin).find((s) => s.id === "copy-trading")!
  assert.deepEqual(copy.items.map((i) => i.label), ["Copy Dashboard", "Connection", "Cockpit", "Risk Management", "Friends"])
  assert.ok(copy.items.every((i) => i.enabled && i.badge === "admin"))
  assert.ok(resolveNavigation(user).find((s) => s.id === "copy-trading")!.items.every((i) => !i.enabled && i.badge === "soon"))
  assert.equal(sectionForPath("/copy-trading/risk-management"), "copy-trading")
  assert.equal(itemForPath("/copy-trading/cockpit")?.item.id, "copy-cockpit")
})

test("the team keeps a way in to what it is still testing", () => {
  for (const id of ["propsync-tracker", "backtesting", "replay"]) {
    assert.equal(byId(admin, id).enabled, true, id)
    assert.equal(byId(admin, id).badge, "admin", id)
  }
  // the affiliate beta perk opens Backtesting, as it did before, and nothing else
  const beta: NavContext = { ...user, hasBeta: true }
  assert.equal(byId(beta, "backtesting").enabled, true)
  assert.equal(byId(beta, "backtesting").badge, "beta")
  assert.equal(byId(beta, "replay").enabled, false)
  assert.equal(byId(beta, "propsync-tracker").enabled, false)
})

test("Edge Lab opens with the release stage of each feature", () => {
  const edge = (ctx: NavContext) => resolveNavigation(ctx).find((s) => s.id === "edge-lab")!
  // not released to this user: the area is there, every page of it closed
  assert.equal(edge(user).enabled, true)
  assert.ok(edge(user).items.every((i) => !i.enabled && i.badge === "soon"))
  // in beta: open, marked Beta
  const beta: NavContext = { ...user, features: { edge_lab: "beta", psychology: "beta" } }
  assert.ok(edge(beta).items.every((i) => i.enabled && i.badge === "beta"))
  // one released without the other
  const half: NavContext = { ...user, features: { edge_lab: "beta" } }
  assert.equal(byId(half, "edge-overview").enabled, true)
  assert.equal(byId(half, "psychology").enabled, false)
  assert.ok(edge(admin).items.every((i) => i.enabled && i.badge === "admin"))
})

test("a Pro page is open to everyone and says so to who isn't Pro", () => {
  assert.equal(byId({ ...user, isPro: false }, "trade-manager").enabled, true)
  assert.equal(byId({ ...user, isPro: false }, "trade-manager").badge, "pro")
  assert.equal(byId(user, "trade-manager").badge, null)
  assert.equal(byId(user, "dashboard").badge, null)
})
