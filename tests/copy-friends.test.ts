import { test } from "node:test"
import assert from "node:assert/strict"
import { activityOf, friendState, friendsTotals, moneyOf, shownTally, tallyCopies, type FriendRow, type OrderRow, type PositionRow, type SharedStrategy, type TallyContext, type TradeRow } from "@/lib/copy/friends"

// The Friends page counts what a copy came to from the copies themselves and
// from the trades the broker closed. Nothing is estimated, a copy tried twice
// is one copy, and a friend's money is in the totals only when they share it.

const at = (h: number, day = "2026-10-08") => new Date(`${day}T${String(h).padStart(2, "0")}:00:00Z`)
const dayOf = (d: Date) => d.toISOString().slice(0, 10)
const order = (master: string, follower: number, status: string, over: Partial<OrderRow> = {}): OrderRow => ({ masterOrderId: master, followerAccountId: follower, action: "open", status, simulated: false, createdAt: at(10), ...over })
const position = (accountId: number, over: Partial<PositionRow> = {}): PositionRow => ({ accountId, status: "closed", simulated: false, positionRef: null, realizedPnl: null, closedAt: at(11), ...over })
const ctx = (trades: TradeRow[] = [], open: Record<string, number> = {}): TallyContext => ({ today: "2026-10-08", dayOf, keyOf: (id) => (id === 99 ? null : `mt5:90${id}`), trades, openPnl: (id, ref) => open[`${id}|${ref}`] ?? null })

test("a copy is counted once whatever it took, and one a follower was never asked to make is not a copy", () => {
  const r = tallyCopies(
    [
      // refused, then tried again and filled: one copy, and it went through
      order("m1-p1-v0", 7, "unsupported", { createdAt: at(9) }),
      order("m1-p1-v0", 7, "filled", { createdAt: at(10) }),
      // the same trade on another account, refused both times
      order("m1-p1-v0", 8, "failed"),
      order("m1-p1-v0", 8, "rejected"),
      // still on its way
      order("m1-p2-v0", 7, "sent"),
      // yesterday's
      order("m1-p0-v0", 7, "filled", { createdAt: at(10, "2026-10-07") }),
      // the follower was switched off: never asked
      order("m1-p3-v0", 7, "skipped"),
      // a close or a stop is not an entry
      order("m1-p1-v1", 7, "filled", { action: "close" }),
      // and a simulated copy is counted apart
      order("m1-p4-v0", 7, "filled", { simulated: true }),
    ],
    [],
    ctx(),
  )
  assert.deepEqual([r.live.copies, r.live.filled, r.live.failed, r.live.pending, r.live.today, r.live.todayFilled], [4, 2, 1, 1, 3, 1])
  assert.equal(r.live.lastCopyAt, at(10).toISOString())
  assert.deepEqual([r.simulated.copies, r.simulated.filled], [1, 1])
})

test("a real position's profit is the trade the broker closed, found by the position's own id", () => {
  const trades: TradeRow[] = [
    { accountId: 7, externalId: "mt5:907:5001", pnl: 120.5, exitTime: at(12) },
    // a netting position that turned round: its second trade belongs to the same position
    { accountId: 7, externalId: "mt5:907:5002", pnl: -40, exitTime: at(13, "2026-10-07") },
    { accountId: 7, externalId: "mt5:907:5002:1", pnl: 15, exitTime: at(14, "2026-10-07") },
    // somebody else's account, the same position number: not this one's
    { accountId: 8, externalId: "mt5:907:5001", pnl: 999, exitTime: at(12) },
    // a longer id that only starts the same way is another position
    { accountId: 7, externalId: "mt5:907:50011", pnl: 777, exitTime: at(12) },
  ]
  const r = tallyCopies(
    [],
    [
      position(7, { positionRef: "5001" }),
      position(7, { positionRef: "5002" }),
      // closed at the broker, and the journal has not synced it yet
      position(7, { positionRef: "5003" }),
      // never tied to a broker position
      position(7, { positionRef: null }),
      // an account the journal has no name for
      position(99, { positionRef: "1" }),
      // open: what the broker reports for it now, when it does
      position(7, { status: "open", positionRef: "6001" }),
      position(7, { status: "open", positionRef: "6002" }),
      // simulated: what the simulation worked out, apart
      position(7, { simulated: true, realizedPnl: 50 }),
      position(7, { simulated: true, status: "open" }),
    ],
    ctx(trades, { "7|6001": -12.25 }),
  )
  assert.deepEqual([r.live.closed, r.live.wins, r.live.closedPnl, r.live.pnlToday, r.live.unsynced], [2, 1, 95.5, 120.5, 3])
  assert.deepEqual([r.live.open, r.live.openPnl], [2, -12.25])
  assert.deepEqual([r.simulated.closed, r.simulated.closedPnl, r.simulated.open, r.simulated.openPnl], [1, 50, 1, null])
})

test("real results are shown when there are any; simulated ones only in their place, and marked", () => {
  const sim = tallyCopies([order("a", 1, "filled", { simulated: true })], [position(1, { simulated: true, realizedPnl: 10 })], ctx())
  assert.deepEqual([shownTally(sim).simulated, activityOf(sim).copies, moneyOf(sim).closedPnl, moneyOf(sim).simulated], [true, 1, 10, true])
  const both = tallyCopies([order("a", 1, "filled", { simulated: true }), order("b", 1, "filled")], [], ctx())
  assert.deepEqual([shownTally(both).simulated, activityOf(both).copies], [false, 1])
  const none = tallyCopies([], [], ctx())
  assert.deepEqual([shownTally(none).simulated, activityOf(none).copies, activityOf(none).lastCopyAt], [false, 0, null])
})

test("where a friend's copying stands", () => {
  assert.equal(friendState("paused", [{ status: "active" }]), "paused_by_owner")
  assert.equal(friendState("active", []), "not_set_up")
  assert.equal(friendState("active", [{ status: "paused" }, { status: "active" }]), "copying")
  assert.equal(friendState("active", [{ status: "paused" }, { status: "draft" }]), "paused")
})

test("the totals count a friend's money only when they share it, and never a simulated figure", () => {
  const live = tallyCopies([order("a", 1, "filled")], [position(1, { positionRef: "1" })], ctx([{ accountId: 1, externalId: "mt5:901:1", pnl: 30, exitTime: at(12) }]))
  const sim = tallyCopies([order("a", 1, "filled", { simulated: true })], [position(1, { simulated: true, realizedPnl: 500 })], ctx())
  const friend = (userId: string, state: FriendRow["state"], r: typeof live, shares: boolean): FriendRow => ({ userId, name: userId, joinedAt: at(1).toISOString(), state, groups: 1, followers: 1, activity: activityOf(r), money: shares ? moneyOf(r) : null })
  const strategy = (friends: FriendRow[], maxFriends = 10): SharedStrategy => ({ shareId: 1, accountId: 1, accountName: "A", name: "S", status: "active", token: "t", maxFriends, createdAt: at(1).toISOString(), friends })
  const totals = friendsTotals([strategy([friend("shares", "copying", live, true), friend("private", "copying", live, false), friend("simulated", "paused", sim, true)], 5), strategy([], 3)])
  assert.deepEqual(totals, { friends: 3, seats: 8, copying: 2, copiesToday: 2, pnlFrom: 1, pnlToday: 30, closedPnl: 30 })
})
