import { pool } from "@/lib/db"
import { ownerEmails } from "@/lib/subscription"
import { PLAN_PRICING, type PlanTier } from "@/lib/whop"

// Read-only queries behind the admin pages. Raw SQL because these are
// aggregates across many tables; every value comes from real rows.

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[]
}
const n = (v: unknown) => Number(v ?? 0)

// Each user's current subscription: the row that grants access if any
// (admin grants lapse at currentPeriodEnd), otherwise the newest. Pending
// checkouts never count.
const CURRENT_PLAN_CTE = `
  current_plan as (
    select distinct on ("userId") "userId", plan, status, source, billing, "currentPeriodEnd", "updatedAt",
      (status in ('active','trialing','past_due')
        and not (source = 'admin' and "currentPeriodEnd" is not null and "currentPeriodEnd" < now())) as has_access
    from subscriptions
    where "userId" is not null and status <> 'pending'
    order by "userId", has_access desc, "updatedAt" desc
  )`

// "Active" = seen in a signed-in session. Sessions refresh at most once a day,
// so these are day-granular; impersonation sessions are excluded.
export async function getOverview() {
  const [row] = await q(`
    select
      (select count(*) from "user") as users,
      (select count(*) from "user" where "createdAt" > now() - interval '7 days') as signups_7d,
      (select count(*) from "user" where "createdAt" > now() - interval '30 days') as signups_30d,
      (select count(*) from "user" where banned) as suspended,
      (select count(distinct "userId") from session where "impersonatedBy" is null and "updatedAt" > now() - interval '1 day') as dau,
      (select count(distinct "userId") from session where "impersonatedBy" is null and "updatedAt" > now() - interval '7 days') as wau,
      (select count(distinct "userId") from session where "impersonatedBy" is null and "updatedAt" > now() - interval '30 days') as mau,
      (select count(*) from trades where "createdAt" > now() - interval '7 days') as trades_7d,
      (select count(distinct "userId") from trades where "createdAt" > now() - interval '7 days') as traders_7d,
      (select count(*) from trades) as trades_total
  `)
  return {
    users: n(row.users),
    signups7d: n(row.signups_7d),
    signups30d: n(row.signups_30d),
    suspended: n(row.suspended),
    dau: n(row.dau),
    wau: n(row.wau),
    mau: n(row.mau),
    trades7d: n(row.trades_7d),
    traders7d: n(row.traders_7d),
    tradesTotal: n(row.trades_total),
  }
}

// How many users have used each feature at least once.
export async function getFeatureAdoption() {
  const [row] = await q(`
    select
      (select count(distinct "userId") from trades) as trades,
      (select count(distinct "userId") from journal_entries) as journal,
      (select count(distinct "userId") from playbooks) as playbooks,
      (select count(distinct "userId") from tag_groups) as tags,
      (select count(distinct "userId") from prop_firm_rules) as propfirm,
      (select count(distinct "userId") from (select "userId" from rithmic_connections union select "userId" from metatrader_connections) b) as broker_sync,
      (select count(distinct "userId") from dashboard_templates) as templates,
      (select count(distinct "userId") from (select "userId" from daily_pnl_shares union select "userId" from payout_shares union select "userId" from trades where "shareToken" is not null) s) as sharing
  `)
  return [
    { feature: "Trade log", users: n(row.trades) },
    { feature: "Journal", users: n(row.journal) },
    { feature: "Broker sync", users: n(row.broker_sync) },
    { feature: "Prop firm tracking", users: n(row.propfirm) },
    { feature: "Playbooks", users: n(row.playbooks) },
    { feature: "Custom tags", users: n(row.tags) },
    { feature: "Sharing", users: n(row.sharing) },
    { feature: "Dashboard templates", users: n(row.templates) },
  ].sort((a, b) => b.users - a.users)
}

// Onboarding funnel for users who signed up in the window.
export async function getFunnel(days: number) {
  const [row] = await q(
    `
    with cohort as (select id from "user" where "createdAt" > now() - make_interval(days => $1))
    select
      (select count(*) from cohort) as registered,
      (select count(distinct t."userId") from trading_accounts t join cohort c on c.id = t."userId") as account_created,
      (select count(distinct t."userId") from trades t join cohort c on c.id = t."userId") as first_trade,
      (select count(distinct s."userId") from subscriptions s join cohort c on c.id = s."userId" where s.status <> 'pending') as subscribed
  `,
    [days]
  )
  return [
    { step: "Registered", users: n(row.registered) },
    { step: "Created a trading account", users: n(row.account_created) },
    { step: "Logged a first trade", users: n(row.first_trade) },
    { step: "Started a plan", users: n(row.subscribed) },
  ]
}

// Monthly-equivalent list price. Launch promos aren't subtracted, so these
// revenue numbers are estimates at list price.
function monthlyPrice(plan: string, billing: string | null) {
  const pricing = PLAN_PRICING[plan as PlanTier]
  if (!pricing) return 0
  return billing === "annual" ? pricing.annualPrice : pricing.monthlyPrice
}

export async function getRevenue() {
  const rows = await q<{ plan: string; billing: string | null; status: string; source: string; count: string }>(`
    with ${CURRENT_PLAN_CTE}
    select plan, billing, status, source, count(*) from current_plan where has_access group by 1, 2, 3, 4
  `)
  const [churn] = await q(`
    select
      count(*) filter (where status in ('canceled','expired') and "updatedAt" > now() - interval '30 days') as churned_30d
    from subscriptions where source = 'whop' and "userId" is not null
  `)
  const [pending] = await q(`select count(*) from subscriptions where status = 'pending' and "createdAt" > now() - interval '7 days'`)

  let mrr = 0
  let paying = 0
  let trialing = 0
  let granted = 0
  const byPlan: Record<string, { paying: number; trialing: number; granted: number }> = {}
  for (const r of rows) {
    const count = n(r.count)
    const bucket = (byPlan[r.plan] ??= { paying: 0, trialing: 0, granted: 0 })
    if (r.source === "admin") {
      granted += count
      bucket.granted += count
    } else if (r.status === "trialing") {
      trialing += count
      bucket.trialing += count
    } else {
      paying += count
      bucket.paying += count
      mrr += count * monthlyPrice(r.plan, r.billing)
    }
  }
  const churned30d = n(churn.churned_30d)
  // Share of the paying base lost in the last 30 days.
  const churnRate = paying + churned30d > 0 ? churned30d / (paying + churned30d) : null
  const arpu = paying > 0 ? mrr / paying : null
  const ltv = arpu != null && churnRate ? arpu / churnRate : null

  return {
    mrr,
    arr: mrr * 12,
    paying,
    trialing,
    granted,
    churned30d,
    churnRate,
    arpu,
    ltv,
    abandonedCheckouts7d: n(pending.count),
    byPlan,
  }
}

export async function listSubscriptions(status: string | undefined, limit = 100) {
  const filters: Record<string, string> = {
    access: `s.status in ('active','trialing','past_due')`,
    trialing: `s.status = 'trialing'`,
    canceled: `s.status in ('canceled','expired')`,
    pending: `s.status = 'pending'`,
    admin: `s.source = 'admin'`,
  }
  const where = status && filters[status] ? `where ${filters[status]}` : ""
  return q<{
    id: number
    userId: string | null
    email: string
    name: string | null
    plan: string
    status: string
    billing: string | null
    source: string
    currentPeriodEnd: Date | null
    updatedAt: Date
  }>(
    `select s.id, s."userId", coalesce(u.email, s.email) as email, u.name, s.plan, s.status, s.billing, s.source,
       s."currentPeriodEnd", s."updatedAt"
     from subscriptions s left join "user" u on u.id = s."userId"
     ${where}
     order by s."updatedAt" desc limit $1`,
    [limit]
  )
}

// --- User directory ------------------------------------------------------------

export type UserState = "active" | "inactive" | "suspended" | "canceled"

export interface DirectoryFilters {
  q?: string
  state?: UserState
  plan?: "essential" | "pro"
  broker?: "rithmic" | "metatrader" | "none"
  activity?: "7d" | "30d" | "dormant"
  from?: string
  to?: string
  page?: number
}

export const PAGE_SIZE = 50

export async function listUsers(filters: DirectoryFilters) {
  const params: unknown[] = [ownerEmails()]
  const where: string[] = []
  const param = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  if (filters.q) {
    const like = param(`%${filters.q}%`)
    where.push(`(email ilike ${like} or name ilike ${like})`)
  }
  if (filters.state) where.push(`state = ${param(filters.state)}`)
  if (filters.plan) where.push(`plan = ${param(filters.plan)} and has_access`)
  if (filters.broker === "rithmic") where.push(`rithmic`)
  if (filters.broker === "metatrader") where.push(`mt`)
  if (filters.broker === "none") where.push(`not (rithmic or mt)`)
  if (filters.activity === "7d") where.push(`seen > now() - interval '7 days'`)
  if (filters.activity === "30d") where.push(`seen > now() - interval '30 days'`)
  if (filters.activity === "dormant") where.push(`(seen is null or seen < now() - interval '30 days')`)
  if (filters.from) where.push(`"createdAt" >= ${param(filters.from)}::date`)
  if (filters.to) where.push(`"createdAt" < ${param(filters.to)}::date + 1`)

  const sql = `
    with ${CURRENT_PLAN_CTE},
    last_seen as (select "userId", max("updatedAt") as seen from session where "impersonatedBy" is null group by "userId"),
    brokers as (
      select "userId", bool_or(kind = 'rithmic') as rithmic, bool_or(kind = 'metatrader') as mt from (
        select "userId", 'rithmic' as kind from rithmic_connections
        union all select "userId", 'metatrader' from metatrader_connections
      ) x group by "userId"
    ),
    trade_counts as (select "userId", count(*) as trades from trades group by "userId"),
    users as (
      select u.id, u.name, u.email, u."createdAt", u.role, coalesce(u.banned, false) as banned,
        lower(u.email) = any($1) as is_owner,
        p.plan, p.status as sub_status, p.source as sub_source,
        coalesce(p.has_access, false) or lower(u.email) = any($1) as has_access,
        ls.seen, coalesce(tc.trades, 0) as trades, coalesce(b.rithmic, false) as rithmic, coalesce(b.mt, false) as mt,
        case
          when coalesce(u.banned, false) then 'suspended'
          when coalesce(p.has_access, false) or lower(u.email) = any($1) then 'active'
          when p."userId" is not null then 'canceled'
          else 'inactive'
        end as state
      from "user" u
      left join current_plan p on p."userId" = u.id
      left join last_seen ls on ls."userId" = u.id
      left join brokers b on b."userId" = u.id
      left join trade_counts tc on tc."userId" = u.id
    )
    select * from users ${where.length ? `where ${where.join(" and ")}` : ""}`

  const page = Math.max(1, filters.page ?? 1)
  const [rows, [{ count }]] = await Promise.all([
    q<DirectoryRow>(`${sql} order by "createdAt" desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`, params),
    q<{ count: string }>(`select count(*) from (${sql}) t`, params),
  ])
  return { rows, total: n(count), page }
}

export interface DirectoryRow {
  id: string
  name: string
  email: string
  createdAt: Date
  role: string | null
  banned: boolean
  is_owner: boolean
  plan: string | null
  sub_status: string | null
  sub_source: string | null
  has_access: boolean
  seen: Date | null
  trades: string
  rithmic: boolean
  mt: boolean
  state: UserState
}

// --- User profile ----------------------------------------------------------------

export async function getUserProfile(userId: string) {
  const [userRow] = await q<{
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    createdAt: Date
    role: string | null
    banned: boolean | null
    banReason: string | null
    banExpires: Date | null
    twoFactorEnabled: boolean | null
  }>(`select id, name, email, "emailVerified", image, "createdAt", role, banned, "banReason", "banExpires", "twoFactorEnabled" from "user" where id = $1`, [userId])
  if (!userRow) return null

  const [providers, sessions, subs, counts, rithmic, mt, audit] = await Promise.all([
    q<{ providerId: string; createdAt: Date }>(`select "providerId", "createdAt" from account where "userId" = $1 order by "createdAt"`, [userId]),
    q<{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; ipAddress: string | null; userAgent: string | null; impersonatedBy: string | null }>(
      `select id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent", "impersonatedBy" from session where "userId" = $1 order by "createdAt" desc limit 25`,
      [userId]
    ),
    q<{ id: number; plan: string; status: string; billing: string | null; source: string; currentPeriodEnd: Date | null; createdAt: Date; updatedAt: Date; whopMembershipId: string | null }>(
      `select id, plan, status, billing, source, "currentPeriodEnd", "createdAt", "updatedAt", "whopMembershipId" from subscriptions where "userId" = $1 order by "updatedAt" desc`,
      [userId]
    ),
    q(
      `select
        (select count(*) from trading_accounts where "userId" = $1) as accounts,
        (select count(*) from trades where "userId" = $1) as trades,
        (select max("createdAt") from trades where "userId" = $1) as last_trade,
        (select count(*) from journal_entries where "userId" = $1) as journal,
        (select count(*) from playbooks where "userId" = $1) as playbooks,
        (select count(*) from prop_firm_rules where "userId" = $1) as propfirm,
        (select count(*) from tag_groups where "userId" = $1) as tag_groups`,
      [userId]
    ),
    q<{ id: number; accountName: string | null; systemName: string; lastSyncedAt: Date | null; lastSyncStatus: string | null; lastSyncError: string | null; lastSyncCount: number | null; createdAt: Date }>(
      `select id, "accountName", "systemName", "lastSyncedAt", "lastSyncStatus", "lastSyncError", "lastSyncCount", "createdAt" from rithmic_connections where "userId" = $1 order by id`,
      [userId]
    ),
    q<{ id: number; server: string; login: string; lastSyncedAt: Date | null; lastSyncStatus: string | null; lastSyncError: string | null; lastSyncCount: number | null; createdAt: Date }>(
      `select id, server, login, "lastSyncedAt", "lastSyncStatus", "lastSyncError", "lastSyncCount", "createdAt" from metatrader_connections where "userId" = $1 order by id`,
      [userId]
    ),
    q<{ id: number; actorEmail: string; action: string; details: unknown; createdAt: Date }>(
      `select id, "actorEmail", action, details, "createdAt" from admin_audit_log where "targetUserId" = $1 order by "createdAt" desc limit 25`,
      [userId]
    ),
  ])
  const c = counts[0]
  return {
    user: userRow,
    providers,
    sessions,
    subscriptions: subs,
    counts: {
      accounts: n(c.accounts),
      trades: n(c.trades),
      lastTrade: (c.last_trade as Date | null) ?? null,
      journal: n(c.journal),
      playbooks: n(c.playbooks),
      propfirm: n(c.propfirm),
      tagGroups: n(c.tag_groups),
    },
    rithmic,
    metatrader: mt,
    audit,
  }
}

// --- Brokers ---------------------------------------------------------------------

// The background Rithmic job runs every 60s, so a connection that hasn't
// synced in an hour isn't being picked up.
export async function getBrokerHealth() {
  const connections = await q<{
    broker: "rithmic" | "metatrader"
    id: number
    userId: string
    email: string | null
    label: string
    lastSyncedAt: Date | null
    lastSyncStatus: string | null
    lastSyncError: string | null
    lastSyncCount: number | null
  }>(`
    select 'rithmic' as broker, r.id, r."userId", u.email, coalesce(r."accountName", r."systemName") as label,
      r."lastSyncedAt", r."lastSyncStatus", r."lastSyncError", r."lastSyncCount"
    from rithmic_connections r left join "user" u on u.id = r."userId"
    union all
    select 'metatrader', m.id, m."userId", u.email, m.server || ' · ' || m.login,
      m."lastSyncedAt", m."lastSyncStatus", m."lastSyncError", m."lastSyncCount"
    from metatrader_connections m left join "user" u on u.id = m."userId"
    order by 7 nulls first, 6 nulls first
  `)
  const hourAgo = Date.now() - 3600_000
  type Health = "healthy" | "stale" | "failing" | "never"
  const health = (c: (typeof connections)[number]): Health =>
    c.lastSyncStatus === "error" ? "failing" : !c.lastSyncedAt ? "never" : c.lastSyncedAt.getTime() < hourAgo ? "stale" : "healthy"
  const summary = (broker: "rithmic" | "metatrader") => {
    const list = connections.filter((c) => c.broker === broker)
    return {
      total: list.length,
      healthy: list.filter((c) => health(c) === "healthy").length,
      stale: list.filter((c) => health(c) === "stale").length,
      failing: list.filter((c) => health(c) === "failing").length,
      never: list.filter((c) => health(c) === "never").length,
    }
  }
  return {
    connections: connections.map((c) => ({ ...c, health: health(c) })),
    rithmic: summary("rithmic"),
    metatrader: summary("metatrader"),
  }
}

// --- Audit + team ----------------------------------------------------------------

export async function listAudit(filters: { actor?: string; action?: string; page?: number }) {
  const params: unknown[] = []
  const where: string[] = []
  if (filters.actor) {
    params.push(`%${filters.actor}%`)
    where.push(`a."actorEmail" ilike $${params.length}`)
  }
  if (filters.action) {
    params.push(filters.action)
    where.push(`a.action = $${params.length}`)
  }
  const page = Math.max(1, filters.page ?? 1)
  const sql = `
    select a.id, a."actorEmail", a.action, a."targetUserId", t.email as "targetEmail", a.details, a."ipAddress", a."createdAt"
    from admin_audit_log a left join "user" t on t.id = a."targetUserId"
    ${where.length ? `where ${where.join(" and ")}` : ""}`
  const [rows, [{ count }]] = await Promise.all([
    q<{ id: number; actorEmail: string; action: string; targetUserId: string | null; targetEmail: string | null; details: Record<string, unknown> | null; ipAddress: string | null; createdAt: Date }>(
      `${sql} order by a."createdAt" desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      params
    ),
    q<{ count: string }>(`select count(*) from (${sql}) t`, params),
  ])
  return { rows, total: n(count), page }
}

export async function listTeam() {
  return q<{ id: string; name: string; email: string; role: string; createdAt: Date; seen: Date | null }>(`
    select u.id, u.name, u.email, u.role, u."createdAt",
      (select max("updatedAt") from session s where s."userId" = u.id and s."impersonatedBy" is null) as seen
    from "user" u where u.role is not null and u.role <> 'user'
    order by u."createdAt"
  `)
}

export async function listAnnouncements() {
  return q<{ id: number; message: string; level: string; active: boolean; endsAt: Date | null; createdBy: string; createdAt: Date }>(
    `select id, message, level, active, "endsAt", "createdBy", "createdAt" from announcements order by "createdAt" desc limit 50`
  )
}

// --- Security ----------------------------------------------------------------------

export async function getSecurityOverview() {
  const [counts] = await q(`
    select
      count(*) filter (where type = 'sign_in_failed') as failed,
      count(*) filter (where type = 'sign_in_blocked') as blocked,
      count(*) filter (where type = 'two_factor_failed') as two_factor_failed,
      count(*) filter (where type = 'sign_in') as sign_ins,
      count(*) filter (where type = 'sign_in' and (details->>'newIp')::boolean) as new_ip,
      count(*) filter (where type in ('password_reset_requested', 'password_reset')) as resets
    from security_events where "createdAt" > now() - interval '24 hours'
  `)
  const [adoption] = await q(`select count(*) filter (where "twoFactorEnabled") as enabled, count(*) as total from "user"`)
  // Five or more failures from one IP, or against one email, in a day.
  const suspiciousIps = await q<{ ip: string; failures: string; emails: string; last: Date }>(`
    select "ipAddress" as ip, count(*) as failures, count(distinct email) as emails, max("createdAt") as last
    from security_events
    where type in ('sign_in_failed', 'two_factor_failed') and "createdAt" > now() - interval '24 hours' and "ipAddress" is not null
    group by "ipAddress" having count(*) >= 5 order by count(*) desc limit 20
  `)
  const targetedEmails = await q<{ email: string; userId: string | null; failures: string; ips: string; last: Date }>(`
    select email, max("userId") as "userId", count(*) as failures, count(distinct "ipAddress") as ips, max("createdAt") as last
    from security_events
    where type = 'sign_in_failed' and "createdAt" > now() - interval '24 hours' and email is not null
    group by email having count(*) >= 5 order by count(*) desc limit 20
  `)
  return {
    failed24h: n(counts.failed),
    blocked24h: n(counts.blocked),
    twoFactorFailed24h: n(counts.two_factor_failed),
    signIns24h: n(counts.sign_ins),
    newIp24h: n(counts.new_ip),
    resets24h: n(counts.resets),
    twoFactorUsers: n(adoption.enabled),
    totalUsers: n(adoption.total),
    suspiciousIps,
    targetedEmails,
  }
}

export type SecurityEventRow = { id: number; type: string; userId: string | null; email: string | null; ipAddress: string | null; userAgent: string | null; details: Record<string, unknown> | null; createdAt: Date }

export async function listSecurityEvents(filters: { type?: string; q?: string; userId?: string; page?: number; limit?: number }) {
  const params: unknown[] = []
  const where: string[] = []
  if (filters.type) {
    params.push(filters.type)
    where.push(`type = $${params.length}`)
  }
  if (filters.q) {
    params.push(`%${filters.q}%`)
    where.push(`(email ilike $${params.length} or "ipAddress" ilike $${params.length})`)
  }
  if (filters.userId) {
    params.push(filters.userId)
    where.push(`"userId" = $${params.length}`)
  }
  const limit = filters.limit ?? PAGE_SIZE
  const page = Math.max(1, filters.page ?? 1)
  const sql = `select id, type, "userId", email, "ipAddress", "userAgent", details, "createdAt" from security_events ${where.length ? `where ${where.join(" and ")}` : ""}`
  const [rows, [{ count }]] = await Promise.all([
    q<SecurityEventRow>(`${sql} order by "createdAt" desc limit ${limit} offset ${(page - 1) * limit}`, params),
    q<{ count: string }>(`select count(*) from (${sql}) t`, params),
  ])
  return { rows, total: n(count), page }
}

// --- Support -------------------------------------------------------------------------

export async function listTickets(status: string | undefined) {
  const params: unknown[] = []
  let where = ""
  if (status === "open" || status === "waiting" || status === "closed") {
    params.push(status)
    where = `where t.status = $1`
  }
  return q<{ id: number; subject: string; status: string; lastMessageAt: Date; createdAt: Date; userId: string; email: string | null; name: string | null; messages: string; lastFromStaff: boolean | null }>(
    `select t.id, t.subject, t.status, t."lastMessageAt", t."createdAt", t."userId", u.email, u.name,
       (select count(*) from support_messages m where m."ticketId" = t.id) as messages,
       (select m."fromStaff" from support_messages m where m."ticketId" = t.id order by m."createdAt" desc limit 1) as "lastFromStaff"
     from support_tickets t left join "user" u on u.id = t."userId"
     ${where}
     order by (t.status = 'open') desc, t."lastMessageAt" desc limit 200`,
    params
  )
}

export async function getTicket(id: number) {
  const [ticket] = await q<{ id: number; subject: string; status: string; createdAt: Date; userId: string; email: string | null; name: string | null }>(
    `select t.id, t.subject, t.status, t."createdAt", t."userId", u.email, u.name from support_tickets t left join "user" u on u.id = t."userId" where t.id = $1`,
    [id]
  )
  if (!ticket) return null
  const messages = await q<{ id: number; body: string; fromStaff: boolean; createdAt: Date; authorEmail: string | null; authorName: string | null }>(
    `select m.id, m.body, m."fromStaff", m."createdAt", a.email as "authorEmail", a.name as "authorName"
     from support_messages m left join "user" a on a.id = m."authorId" where m."ticketId" = $1 order by m."createdAt"`,
    [id]
  )
  return { ticket, messages }
}

export async function openTicketCount() {
  const [row] = await q(`select count(*) from support_tickets where status = 'open'`)
  return n(row.count)
}

export async function listUserTickets(userId: string) {
  return q<{ id: number; subject: string; status: string; lastMessageAt: Date }>(
    `select id, subject, status, "lastMessageAt" from support_tickets where "userId" = $1 order by "lastMessageAt" desc limit 20`,
    [userId]
  )
}
