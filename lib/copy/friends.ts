// The Friends page of Copy Trading: who copies the strategies a trader shares,
// and the strategies that trader copies, each with what came of it.
//
// What a copy came to is counted from the copies themselves (copy_orders,
// copy_positions) and, for a real position, from the trade the broker closed
// as the journal has it (trades): nothing here is estimated. A copy that was
// tried again is one copy, with the outcome of its last try.
//
// Who sees what. A trader always sees their own results. Of a friend, the
// owner of a strategy sees whether they are copying and how many copies went
// through; the money (profit and loss, open positions) only when that friend
// has said so (copy_share_members.shareResults). Never a balance, an account
// or a trade that was not a copy of this strategy.
//
// Pure: the loader is lib/copy/friends-server.ts.

// the most friends one strategy can have (lib/copy/shares.ts holds to it)
export const MAX_FRIENDS = 10

export type Tally = {
  // entries of the Leader that reached this trader's followers, and what became of them
  copies: number
  filled: number
  failed: number
  pending: number
  today: number
  todayFilled: number
  lastCopyAt: string | null
  // copied positions that are closed, and their profit or loss
  closed: number
  wins: number
  closedPnl: number
  pnlToday: number
  // closed at the broker, and the journal has not caught up with the trade yet
  unsynced: number
  open: number
  // of the open ones the broker reports a figure for; null when it reports none
  openPnl: number | null
}

export const EMPTY_TALLY: Tally = { copies: 0, filled: 0, failed: 0, pending: 0, today: 0, todayFilled: 0, lastCopyAt: null, closed: 0, wins: 0, closedPnl: 0, pnlToday: 0, unsynced: 0, open: 0, openPnl: null }

export type CopyResults = { live: Tally; simulated: Tally }

export type OrderRow = { masterOrderId: string; followerAccountId: number; action: string; status: string; simulated: boolean; createdAt: Date }
export type PositionRow = { accountId: number; status: string; simulated: boolean; positionRef: string | null; realizedPnl: number | null; closedAt: Date | null }
export type TradeRow = { accountId: number; externalId: string; pnl: number; exitTime: Date | null }

export type TallyContext = {
  today: string
  dayOf: (at: Date) => string
  // how the journal names a broker position of this account: "mt5:<login>" (lib/metatrader-trades.ts); null when it can't
  keyOf: (accountId: number) => string | null
  trades: TradeRow[]
  // what the broker reports for an open position, when it does
  openPnl: (accountId: number, positionRef: string) => number | null
}

const round = (n: number) => Math.round(n * 100) / 100
const WENT = new Set(["filled", "partial"])
const WAITING = new Set(["pending", "sent"])
const NOT_TRIED = new Set(["skipped", "cancelled"])

export function tallyCopies(orders: OrderRow[], positions: PositionRow[], ctx: TallyContext): CopyResults {
  const out: CopyResults = { live: { ...EMPTY_TALLY }, simulated: { ...EMPTY_TALLY } }

  // one copy per entry of the Leader and follower account, however many times it was tried
  const copies = new Map<string, { simulated: boolean; first: Date; last: Date; statuses: string[] }>()
  for (const o of orders) {
    if (o.action !== "open" && o.action !== "increase") continue
    const key = `${o.simulated ? "s" : "l"}|${o.masterOrderId}|${o.followerAccountId}`
    const c = copies.get(key)
    if (!c) copies.set(key, { simulated: o.simulated, first: o.createdAt, last: o.createdAt, statuses: [o.status] })
    else {
      if (o.createdAt < c.first) c.first = o.createdAt
      if (o.createdAt > c.last) c.last = o.createdAt
      c.statuses.push(o.status)
    }
  }
  for (const c of copies.values()) {
    // a follower that was switched off was never asked to copy it
    if (c.statuses.every((s) => NOT_TRIED.has(s))) continue
    const t = c.simulated ? out.simulated : out.live
    const went = c.statuses.some((s) => WENT.has(s))
    const waiting = !went && c.statuses.some((s) => WAITING.has(s))
    const today = ctx.dayOf(c.first) === ctx.today
    t.copies++
    if (today) t.today++
    if (went) {
      t.filled++
      if (today) t.todayFilled++
      if (t.lastCopyAt == null || c.last.toISOString() > t.lastCopyAt) t.lastCopyAt = c.last.toISOString()
    } else if (waiting) t.pending++
    else t.failed++
  }

  for (const p of positions) {
    const t = p.simulated ? out.simulated : out.live
    if (p.status !== "closed") {
      t.open++
      const pnl = !p.simulated && p.positionRef ? ctx.openPnl(p.accountId, p.positionRef) : null
      if (pnl != null) t.openPnl = round((t.openPnl ?? 0) + pnl)
      continue
    }
    let pnl: number | null = null
    let when: Date | null = p.closedAt
    if (p.simulated) pnl = p.realizedPnl
    else {
      // the trade as the broker closed it, by the position's own id: one trade, or one per turn of a netting position
      const key = p.positionRef ? ctx.keyOf(p.accountId) : null
      const id = key ? `${key}:${p.positionRef}` : null
      const mine = id ? ctx.trades.filter((x) => x.accountId === p.accountId && (x.externalId === id || x.externalId.startsWith(`${id}:`))) : []
      if (mine.length) {
        pnl = mine.reduce((s, x) => s + x.pnl, 0)
        when = mine.reduce<Date | null>((latest, x) => (x.exitTime && (!latest || x.exitTime > latest) ? x.exitTime : latest), null) ?? when
      }
    }
    if (pnl == null) {
      t.unsynced++
      continue
    }
    t.closed++
    if (pnl > 0) t.wins++
    t.closedPnl = round(t.closedPnl + pnl)
    if (when && ctx.dayOf(when) === ctx.today) t.pnlToday = round(t.pnlToday + pnl)
  }
  return out
}

// Which of the two is shown: real copies when there are any, else the simulated ones, marked as such.
const has = (t: Tally) => t.copies > 0 || t.closed > 0 || t.open > 0 || t.unsynced > 0
export function shownTally(r: CopyResults): { tally: Tally; simulated: boolean } {
  return has(r.live) || !has(r.simulated) ? { tally: r.live, simulated: false } : { tally: r.simulated, simulated: true }
}

// Where a friend's copying stands. paused_by_owner: the owner has switched it off for them.
export type FriendState = "copying" | "paused" | "paused_by_owner" | "not_set_up"
export const FRIEND_STATE: Record<FriendState, { label: string; tone: "good" | "warn" | "none" }> = {
  copying: { label: "Copying", tone: "good" },
  paused: { label: "Not copying", tone: "none" },
  paused_by_owner: { label: "Paused by owner", tone: "warn" },
  not_set_up: { label: "Not set up yet", tone: "none" },
}
export function friendState(membership: string, groups: { status: string }[]): FriendState {
  if (membership === "paused") return "paused_by_owner"
  if (!groups.length) return "not_set_up"
  return groups.some((g) => g.status === "active") ? "copying" : "paused"
}

// How the copying went: always seen by the strategy's owner.
export type Activity = Pick<Tally, "copies" | "filled" | "failed" | "pending" | "today" | "todayFilled" | "lastCopyAt"> & { simulated: boolean }
// What it came to in money: seen by the owner only when the friend shares it.
export type Money = Pick<Tally, "closed" | "wins" | "closedPnl" | "pnlToday" | "unsynced" | "open" | "openPnl"> & { simulated: boolean }

export function activityOf(r: CopyResults): Activity {
  const { tally: t, simulated } = shownTally(r)
  return { copies: t.copies, filled: t.filled, failed: t.failed, pending: t.pending, today: t.today, todayFilled: t.todayFilled, lastCopyAt: t.lastCopyAt, simulated }
}
export function moneyOf(r: CopyResults): Money {
  const { tally: t, simulated } = shownTally(r)
  return { closed: t.closed, wins: t.wins, closedPnl: t.closedPnl, pnlToday: t.pnlToday, unsynced: t.unsynced, open: t.open, openPnl: t.openPnl, simulated }
}

export type FriendRow = {
  userId: string
  name: string
  joinedAt: string
  state: FriendState
  // their groups on this strategy, and the accounts those copy to
  groups: number
  followers: number
  activity: Activity
  // null: this friend has not shared their results
  money: Money | null
}
export type SharedStrategy = { shareId: number; accountId: number; accountName: string; name: string; status: "active" | "paused"; token: string; maxFriends: number; createdAt: string; friends: FriendRow[] }
export type FollowedStrategy = {
  shareId: number
  accountId: number
  name: string
  owner: string
  joinedAt: string
  state: FriendState
  // whether the owner may see this trader's results
  sharesResults: boolean
  groups: { id: number; name: string; status: string }[]
  followers: number
  activity: Activity
  money: Money
}
export type FriendsTotals = {
  friends: number
  seats: number
  copying: number
  copiesToday: number
  // of the friends who share their results: how many that is, and the sum; simulated results are left out
  pnlFrom: number
  pnlToday: number
  closedPnl: number
}
export type FriendsOverview = { sharing: SharedStrategy[]; following: FollowedStrategy[]; totals: FriendsTotals }

export function friendsTotals(sharing: SharedStrategy[]): FriendsTotals {
  const friends = sharing.flatMap((s) => s.friends)
  const withMoney = friends.filter((f) => f.money && !f.money.simulated)
  return {
    friends: friends.length,
    seats: sharing.reduce((n, s) => n + s.maxFriends, 0),
    copying: friends.filter((f) => f.state === "copying").length,
    copiesToday: friends.reduce((n, f) => n + (f.activity.simulated ? 0 : f.activity.today), 0),
    pnlFrom: withMoney.length,
    pnlToday: round(withMoney.reduce((n, f) => n + f.money!.pnlToday, 0)),
    closedPnl: round(withMoney.reduce((n, f) => n + f.money!.closedPnl, 0)),
  }
}
