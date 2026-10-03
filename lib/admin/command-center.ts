import { cache } from "react"
import { pool } from "@/lib/db"
import { getRevenue, monthlyPrice } from "@/lib/admin/metrics"
import { roleCan, type AdminRole } from "@/lib/admin/access"
import { ACTION_LABELS } from "@/lib/admin/audit"
import { emailConfigured } from "@/lib/email"
import { supportInbox } from "@/lib/emails/policy"
import { ticketIdFromRef, ticketRef } from "@/lib/support/request"
import { readHeartbeat } from "@/lib/heartbeat"
import { ledgerBalances } from "@/lib/affiliates/engine"
import { TRIAL_DAYS } from "@/lib/whop"
import {
  appHealth,
  change,
  databaseHealth,
  dayKey,
  emailHealth,
  isUnread,
  neverCharged,
  newMrr,
  payoutWorkerHealth,
  revenueSeries,
  rithmicHealth,
  uncheckable,
  workerSyncHealth,
  type AdminNotice,
  type HealthCheck,
  type SubSpan,
} from "@/lib/admin/command-center-rules"
import type { AdminPrefs } from "@/lib/admin/preferences"

// The admin command center's queries (the modern Overview, the notification
// bell, the command palette). Read-only, raw SQL like lib/admin/metrics.ts,
// every number from real rows. Each widget loads on its own so one slow or
// failing query never takes the page down with it; each takes the admin's
// capabilities and returns nothing their role can't already see elsewhere.
// Never selected here: passwords, keys, tokens, wallet details, session data.

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[]
}
const n = (v: unknown) => Number(v ?? 0)
const date = (v: unknown) => (v == null ? null : new Date(v as string))
const like = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
// Real trades only: a backtest's simulated trades live in the same table.
const REAL = `coalesce(source, '') <> 'backtest'`

// --- Who can see what -----------------------------------------------------------

export type Capabilities = ReturnType<typeof capabilities>

export function capabilities(role: AdminRole) {
  return {
    users: roleCan(role, { user: ["list"] }),
    userDetail: roleCan(role, { user: ["get"] }),
    billing: roleCan(role, { billing: ["view"] }),
    affiliates: roleCan(role, { affiliates: ["view"] }),
    support: roleCan(role, { support: ["view"] }),
    brokers: roleCan(role, { brokers: ["view"] }),
    security: roleCan(role, { security: ["view"] }),
    analytics: roleCan(role, { analytics: ["view"] }),
    audit: roleCan(role, { audit: ["view"] }),
    announcements: roleCan(role, { announcements: ["manage"] }),
    team: roleCan(role, { team: ["manage"] }),
    cases: roleCan(role, { cases: ["view"] }),
  }
}

// Where a user's name in a widget leads: their profile when the role may open it.
const userHref = (can: Capabilities, id: string | null, email: string | null) =>
  can.userDetail && id ? `/admin/users/${id}` : email ? `/admin/users?q=${encodeURIComponent(email)}` : "/admin/users"

// --- Revenue (estimated at list price) -------------------------------------------

// Every Whop subscription that was ever paying, as a span of time. A
// subscription cancelled before its free trial would have ended was never
// charged and isn't counted.
const subSpans = cache(async (): Promise<SubSpan[]> => {
  const rows = await q<{ userId: string; plan: string; billing: string | null; status: string; createdAt: Date; updatedAt: Date }>(
    `select "userId", plan, billing, status, "createdAt", "updatedAt" from subscriptions
     where source = 'whop' and "userId" is not null and status in ('active', 'past_due', 'canceled', 'expired')`
  )
  const spans: SubSpan[] = []
  for (const r of rows) {
    const ended = r.status === "canceled" || r.status === "expired" ? new Date(r.updatedAt) : null
    const span = { userId: r.userId, started: new Date(r.createdAt), ended, monthly: monthlyPrice(r.plan, r.billing) }
    if (neverCharged(span, TRIAL_DAYS[r.billing === "annual" ? "annual" : "monthly"])) continue
    if (span.monthly > 0) spans.push(span)
  }
  return spans
})

const revenueNow = cache(() => getRevenue())

export async function revenueOverview(days: number, now = new Date()) {
  const [revenue, spans] = await Promise.all([revenueNow(), subSpans()])
  const series = revenueSeries(spans, 365, now)
  const start = series[Math.max(0, series.length - 1 - days)]
  const since = new Date(now.getTime() - days * 86_400_000)
  const prevSince = new Date(now.getTime() - 2 * days * 86_400_000)
  const added = newMrr(spans, since)
  const addedBefore = round(spans.filter((s) => s.started >= prevSince && s.started < since && (!s.ended || s.ended >= since)).reduce((sum, s) => sum + s.monthly, 0))
  const arpuThen = start && start.paying > 0 ? start.mrr / start.paying : null
  return {
    mrr: revenue.mrr,
    arr: revenue.arr,
    paying: revenue.paying,
    trialing: revenue.trialing,
    churnRate: revenue.churnRate,
    churned30d: revenue.churned30d,
    arpu: revenue.arpu,
    newMrr: added,
    trends: {
      mrr: start ? change(revenue.mrr, start.mrr) : null,
      newMrr: change(added, addedBefore),
      arpu: revenue.arpu != null && arpuThen ? change(revenue.arpu, arpuThen) : null,
    },
    series,
  }
}
const round = (v: number) => Math.round(v * 100) / 100

// --- KPI cards ---------------------------------------------------------------------

export type Kpi = { key: string; label: string; value: number; format: "number" | "money"; change: number | null; note: string; href: string | null }

export async function kpis(can: Capabilities, days: number): Promise<Kpi[]> {
  const [row] = await q(
    `select
      (select count(*) from "user") as users,
      (select count(*) from "user" where "createdAt" > now() - make_interval(days => $1::int)) as signups,
      (select count(distinct "userId") from trades where ${REAL} and "createdAt" > now() - make_interval(days => $1::int)) as traders,
      (select count(distinct "userId") from trades where ${REAL} and "createdAt" > now() - make_interval(days => $1::int * 2) and "createdAt" <= now() - make_interval(days => $1::int)) as traders_prev,
      (select count(*) from trades where ${REAL} and "createdAt" > now() - make_interval(days => $1::int)) as trades,
      (select count(*) from trades where ${REAL} and "createdAt" > now() - make_interval(days => $1::int * 2) and "createdAt" <= now() - make_interval(days => $1::int)) as trades_prev`,
    [days]
  )
  const period = `vs. previous ${days} days`
  const users = n(row.users)
  const signups = n(row.signups)
  const out: Kpi[] = [
    { key: "users", label: "Total users", value: users, format: "number", change: change(users, users - signups), note: `+${signups.toLocaleString("en-US")} in ${days} days`, href: can.users ? "/admin/users" : null },
    { key: "traders", label: "Active traders", value: n(row.traders), format: "number", change: change(n(row.traders), n(row.traders_prev)), note: period, href: can.analytics ? "/admin/analytics" : null },
  ]
  if (can.billing) {
    const rev = await revenueOverview(days)
    out.push({ key: "mrr", label: "Estimated MRR", value: rev.mrr, format: "money", change: rev.trends.mrr, note: `${rev.paying} paying · list price`, href: "/admin/billing" })
  }
  if (can.affiliates) {
    const ledger = await ledgerTotals()
    out.push({ key: "held", label: "On-hold funds", value: ledger.pending, format: "money", change: null, note: "commissions on hold", href: "/admin/affiliates" })
  }
  out.push({ key: "trades", label: `Trades, last ${days} days`, value: n(row.trades), format: "number", change: change(n(row.trades), n(row.trades_prev)), note: period, href: can.analytics ? "/admin/analytics" : null })
  return out
}

// The affiliate ledger, summed over everyone (the same arithmetic as each affiliate's balance).
const ledgerTotals = cache(async () => {
  const rows = await q<{ type: string; status: string; amount: string }>(`select type, status, sum(amount) as amount from affiliate_commissions group by 1, 2`)
  const b = ledgerBalances(rows.map((r) => ({ type: r.type, status: r.status, amount: n(r.amount) })))
  // Earned and not yet paid: in its hold period, cleared, or in a payout that hasn't gone out.
  return { pending: b.pending, owed: round(b.pending + b.available + b.processing) }
})

// --- Needs attention ----------------------------------------------------------------

export type AttentionItem = { key: string; label: string; count: number; href: string; tone: "danger" | "warning" | "info" | "primary" }

export async function attention(can: Capabilities): Promise<AttentionItem[]> {
  const parts: string[] = []
  if (can.affiliates) {
    parts.push(`(select count(*) from affiliate_payouts where status in ('pending', 'queued', 'retry_required')) as payouts`)
    parts.push(`(select count(*) from affiliates where status in ('pending', 'review')) as applications`)
    parts.push(`(select count(*) from affiliate_fraud_signals where status in ('open', 'reviewing')) as signals`)
  }
  if (can.support) parts.push(`(select count(*) from support_tickets where status = 'open') as tickets`)
  if (can.brokers) {
    parts.push(`((select count(*) from rithmic_connections where "lastSyncStatus" = 'error') + (select count(*) from metatrader_connections where "lastSyncStatus" = 'error')) as syncs`)
    parts.push(`(select count(*) from import_events where status = 'failed' and "resolvedAt" is null and "createdAt" > now() - interval '7 days') as imports`)
  }
  if (can.billing) parts.push(`(select count(*) from subscriptions where source = 'whop' and status = 'past_due') as past_due`)
  if (can.security)
    parts.push(`(select count(*) from (select "ipAddress" from security_events where type in ('sign_in_failed', 'two_factor_failed') and "createdAt" > now() - interval '24 hours' and "ipAddress" is not null group by 1 having count(*) >= 5) s) as security`)
  if (!parts.length) return []
  const [row] = await q(`select ${parts.join(", ")}`)
  const items: (AttentionItem | null)[] = [
    can.affiliates ? { key: "payouts", label: "Payouts to review", count: n(row.payouts), href: "/admin/affiliates/payouts?tab=pending", tone: "danger" } : null,
    can.support ? { key: "tickets", label: "Support requests", count: n(row.tickets), href: "/admin/support?status=open", tone: "warning" } : null,
    can.brokers ? { key: "syncs", label: "Failing broker syncs", count: n(row.syncs), href: "/admin/brokers", tone: "warning" } : null,
    can.affiliates ? { key: "applications", label: "Affiliate applications", count: n(row.applications), href: "/admin/affiliates/applications", tone: "primary" } : null,
    can.security ? { key: "security", label: "Security alerts", count: n(row.security), href: "/admin/security", tone: "danger" } : null,
    can.affiliates ? { key: "signals", label: "Affiliate risk signals", count: n(row.signals), href: "/admin/affiliates/fraud", tone: "warning" } : null,
    can.billing ? { key: "past_due", label: "Failed renewals", count: n(row.past_due), href: "/admin/billing", tone: "info" } : null,
    can.brokers ? { key: "imports", label: "Failed file imports", count: n(row.imports), href: "/admin/imports", tone: "info" } : null,
  ]
  return items.filter((i): i is AttentionItem => i != null)
}

// --- Recent activity -----------------------------------------------------------------

export type ActivityCategory = "users" | "payments" | "support" | "trading" | "security"
export type ActivityItem = { key: string; category: ActivityCategory; at: string; title: string; detail: string; status: string | null; href: string }

export async function activity(can: Capabilities, limit = 12, only?: ActivityCategory): Promise<ActivityItem[]> {
  const want = (c: ActivityCategory) => !only || only === c
  const jobs: Promise<ActivityItem[]>[] = []
  const per = Math.max(limit, 8)

  if (can.users && want("users")) {
    jobs.push(
      q<{ id: string; email: string; createdAt: Date }>(`select id, email, "createdAt" from "user" order by "createdAt" desc limit $1`, [per]).then((rows) =>
        rows.map((r) => ({ key: `user:${r.id}`, category: "users" as const, at: new Date(r.createdAt).toISOString(), title: "New user registered", detail: r.email, status: "New", href: userHref(can, r.id, r.email) }))
      )
    )
  }
  if (can.affiliates && want("users")) {
    jobs.push(
      q<{ id: number; firstName: string; lastName: string; status: string; createdAt: Date }>(`select id, "firstName", "lastName", status, "createdAt" from affiliates order by "createdAt" desc limit $1`, [per]).then((rows) =>
        rows.map((r) => ({
          key: `aff:${r.id}`,
          category: "users" as const,
          at: new Date(r.createdAt).toISOString(),
          title: "Affiliate application received",
          detail: `${r.firstName} ${r.lastName}`.trim(),
          status: r.status === "pending" || r.status === "review" ? "Pending" : r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : "Suspended",
          href: `/admin/affiliates/${r.id}`,
        }))
      )
    )
  }
  if (can.affiliates && want("payments")) {
    // A payout shows up at its latest step: requested, approved, or paid.
    jobs.push(
      q<{ id: number; amount: string; asset: string | null; methodType: string; status: string; requestedAt: Date; approvedAt: Date | null; completedAt: Date | null; firstName: string; lastName: string }>(
        `select p.id, p.amount, p.asset, p."methodType", p.status, p."requestedAt", p."approvedAt", p."completedAt", a."firstName", a."lastName"
         from affiliate_payouts p join affiliates a on a.id = p."affiliateId"
         order by greatest(p."requestedAt", coalesce(p."approvedAt", p."requestedAt"), coalesce(p."completedAt", p."requestedAt")) desc limit $1`,
        [per]
      ).then((rows) =>
        rows.map((r) => {
          const step = r.status === "paid" && r.completedAt ? { at: r.completedAt, title: "Payout completed", status: "Paid" } : r.approvedAt ? { at: r.approvedAt, title: "Payout approved", status: label(r.status) } : { at: r.requestedAt, title: "Payout requested", status: label(r.status) }
          return { key: `payout:${r.id}:${r.status}`, category: "payments" as const, at: new Date(step.at).toISOString(), title: step.title, detail: `${usd(n(r.amount))}${r.asset ? ` ${r.asset}` : ""} · ${`${r.firstName} ${r.lastName}`.trim()}`, status: step.status, href: `/admin/affiliates/payouts/${r.id}` }
        })
      )
    )
  }
  if (can.billing && want("payments")) {
    jobs.push(
      q<{ id: number; userId: string | null; email: string; plan: string; status: string; billing: string | null; createdAt: Date; updatedAt: Date }>(
        `select s.id, s."userId", coalesce(u.email, s.email) as email, s.plan, s.status, s.billing, s."createdAt", s."updatedAt"
         from subscriptions s left join "user" u on u.id = s."userId"
         where s.source = 'whop' and s.status <> 'pending' order by s."updatedAt" desc limit $1`,
        [per]
      ).then((rows) =>
        rows.map((r) => {
          const ended = r.status === "canceled" || r.status === "expired"
          const plan = `${r.plan.charAt(0).toUpperCase()}${r.plan.slice(1)}${r.billing === "annual" ? " · annual" : ""}`
          return {
            key: `sub:${r.id}:${r.status}`,
            category: "payments" as const,
            at: new Date(ended ? r.updatedAt : r.createdAt).toISOString(),
            title: ended ? "Subscription cancelled" : r.status === "trialing" ? "Free trial started" : r.status === "past_due" ? "Renewal payment failed" : "Subscription started",
            detail: `${r.email} · ${plan}`,
            status: ended ? "Cancelled" : r.status === "trialing" ? "Trial" : r.status === "past_due" ? "Past due" : "Active",
            href: userHref(can, r.userId, r.email),
          }
        })
      )
    )
  }
  if (can.support && want("support")) {
    jobs.push(
      q<{ id: number; subject: string; status: string; createdAt: Date; email: string | null }>(
        `select t.id, t.subject, t.status, t."createdAt", coalesce(u.email, t.email) as email from support_tickets t left join "user" u on u.id = t."userId" order by t."createdAt" desc limit $1`,
        [per]
      ).then((rows) =>
        rows.map((r) => ({ key: `ticket:${r.id}`, category: "support" as const, at: new Date(r.createdAt).toISOString(), title: "Support request received", detail: `${ticketRef(r.id)} · ${r.subject}`, status: r.status === "open" ? "Open" : r.status === "waiting" ? "Waiting" : "Closed", href: `/admin/support/${r.id}` }))
      )
    )
  }
  if (can.brokers && want("trading")) {
    jobs.push(
      q<{ kind: string; id: number; userId: string; email: string | null; label: string; createdAt: Date }>(
        `select * from (
           select 'mt' as kind, m.id, m."userId", u.email, upper(coalesce(m.platform, 'mt5')) || ' · ' || m.server as label, m."createdAt" from metatrader_connections m left join "user" u on u.id = m."userId"
           union all
           select 'rithmic', r.id, r."userId", u.email, 'Rithmic · ' || coalesce(r."accountName", r."systemName"), r."createdAt" from rithmic_connections r left join "user" u on u.id = r."userId"
         ) c order by "createdAt" desc limit $1`,
        [per]
      ).then((rows) =>
        rows.map((r) => ({ key: `conn:${r.kind}:${r.id}`, category: "trading" as const, at: new Date(r.createdAt).toISOString(), title: r.kind === "mt" ? `${r.label.split(" · ")[0]} account connected` : "Rithmic account connected", detail: `${r.email ?? "Unknown user"} · ${r.label.split(" · ").slice(1).join(" · ")}`, status: "Connected", href: userHref(can, r.userId, r.email) }))
      )
    )
  }
  if (can.security && want("security")) {
    jobs.push(
      q<{ id: number; type: string; email: string | null; ipAddress: string | null; createdAt: Date }>(
        `select id, type, email, "ipAddress", "createdAt" from security_events where type in ('sign_in_blocked', 'password_reset', 'two_factor_disabled') order by "createdAt" desc limit $1`,
        [per]
      ).then((rows) =>
        rows.map((r) => ({
          key: `sec:${r.id}`,
          category: "security" as const,
          at: new Date(r.createdAt).toISOString(),
          title: r.type === "sign_in_blocked" ? "Sign-in blocked" : r.type === "password_reset" ? "Password reset" : "Two-step verification turned off",
          detail: [r.email, r.ipAddress].filter(Boolean).join(" · ") || "—",
          status: r.type === "sign_in_blocked" ? "Blocked" : null,
          href: r.email ? `/admin/security?q=${encodeURIComponent(r.email)}` : "/admin/security",
        }))
      )
    )
  }
  const settled = await Promise.allSettled(jobs)
  // A source that fails to load is left out rather than failing the whole list.
  if (jobs.length && settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason
  return settled
    .flatMap((s) => (s.status === "fulfilled" ? s.value : []))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}

const PAYOUT_WORDS: Record<string, string> = { pending: "Pending", queued: "Approved", processing: "Processing", submitted: "Processing", confirming: "Confirming", paid: "Paid", failed: "Failed", retry_required: "Retry", on_hold: "On hold", cancelled: "Cancelled", rejected: "Rejected", reversed: "Reversed" }
const label = (status: string) => PAYOUT_WORDS[status] ?? status

// --- Trading activity -------------------------------------------------------------------

export async function trading(days: number, now = new Date()) {
  const [[row], perDay, [conn]] = await Promise.all([
    q(
      `select
        count(*) filter (where "createdAt" >= date_trunc('month', now())) as month,
        count(*) filter (where "createdAt" >= date_trunc('month', now()) - interval '1 month' and "createdAt" < now() - interval '1 month') as month_prev,
        count(*) filter (where "createdAt" >= date_trunc('day', now())) as today,
        count(*) filter (where "createdAt" >= date_trunc('day', now()) - interval '1 day' and "createdAt" < now() - interval '1 day') as yesterday,
        count(distinct "userId") filter (where "createdAt" > now() - make_interval(days => $1::int)) as traders,
        count(distinct "userId") filter (where "createdAt" > now() - make_interval(days => $1::int * 2) and "createdAt" <= now() - make_interval(days => $1::int)) as traders_prev
      from trades
      where ${REAL} and "createdAt" >= least(date_trunc('month', now()) - interval '1 month', now() - make_interval(days => $1::int * 2))`,
      [days]
    ),
    q<{ day: string; trades: string }>(
      `select to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as day, count(*) as trades from trades
       where ${REAL} and "createdAt" >= date_trunc('day', now()) - interval '13 days' group by 1`
    ),
    q(
      `select
        (select count(*) from rithmic_connections) + (select count(*) from metatrader_connections) as connected,
        (select count(*) from rithmic_connections where "lastSyncedAt" > now() - interval '24 hours') + (select count(*) from metatrader_connections where "lastSyncedAt" > now() - interval '24 hours') as synced`
    ),
  ])
  const counts = new Map(perDay.map((d) => [d.day, n(d.trades)]))
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const chart = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(new Date(today - (13 - i) * 86_400_000))
    return { day, trades: counts.get(day) ?? 0 }
  })
  return {
    month: n(row.month),
    monthChange: change(n(row.month), n(row.month_prev)),
    today: n(row.today),
    todayChange: change(n(row.today), n(row.yesterday)),
    traders: n(row.traders),
    tradersChange: change(n(row.traders), n(row.traders_prev)),
    synced: n(conn.synced),
    connected: n(conn.connected),
    chart,
  }
}

// --- Affiliate + payout operations -------------------------------------------------------

export async function affiliateOps(days: number) {
  const [[row], ledger] = await Promise.all([
    q(
      `select
        (select count(*) from affiliates where status = 'approved') as active,
        (select count(*) from affiliates where status = 'approved' and "approvedAt" > now() - make_interval(days => $1::int)) as approved_recent,
        (select count(*) from affiliates where status in ('pending', 'review')) as applications,
        (select count(*) from affiliate_payouts where status = 'pending') as payouts_pending,
        (select count(*) from affiliate_payouts where status in ('pending', 'queued', 'retry_required', 'on_hold')) as payouts_attention,
        (select coalesce(sum(amount), 0) from affiliate_payouts where status = 'paid' and "completedAt" >= date_trunc('month', now())) as paid_month,
        (select count(*) from affiliate_payouts where status = 'paid' and "completedAt" >= date_trunc('month', now())) as paid_month_count`,
      [days]
    ),
    ledgerTotals(),
  ])
  return {
    active: n(row.active),
    approvedRecent: n(row.approved_recent),
    applications: n(row.applications),
    payoutsPending: n(row.payouts_pending),
    payoutsAttention: n(row.payouts_attention),
    paidMonth: round(n(row.paid_month)),
    paidMonthCount: n(row.paid_month_count),
    owed: ledger.owed,
  }
}

export async function payoutOps(days: number) {
  const [[row]] = await Promise.all([
    q(
      `select
        count(*) filter (where status = 'pending') as pending,
        count(*) filter (where status = 'queued') as approved,
        count(*) filter (where status in ('processing', 'submitted', 'confirming', 'retry_required')) as processing,
        count(*) filter (where status = 'on_hold') as on_hold,
        count(*) filter (where status = 'paid' and "completedAt" > now() - make_interval(days => $1::int)) as completed,
        count(*) filter (where status = 'failed' and coalesce("failedAt", "requestedAt") > now() - make_interval(days => $1::int)) as failed,
        coalesce(sum(amount) filter (where status in ('pending', 'queued', 'processing', 'submitted', 'confirming', 'retry_required', 'on_hold')), 0) as value
      from affiliate_payouts`,
      [days]
    ),
  ])
  return {
    value: round(n(row.value)),
    rows: [
      { key: "pending", label: "Pending review", count: n(row.pending), href: "/admin/affiliates/payouts?tab=pending", tone: "warning" as const },
      { key: "approved", label: "Approved, to send", count: n(row.approved), href: "/admin/affiliates/payouts?tab=processing", tone: "primary" as const },
      { key: "processing", label: "Processing", count: n(row.processing), href: "/admin/affiliates/payouts?tab=processing", tone: "info" as const },
      { key: "on_hold", label: "On hold", count: n(row.on_hold), href: "/admin/affiliates/payouts?tab=on_hold", tone: "muted" as const },
      { key: "completed", label: `Completed, ${days} days`, count: n(row.completed), href: "/admin/affiliates/payouts?tab=completed", tone: "success" as const },
      { key: "failed", label: `Failed, ${days} days`, count: n(row.failed), href: "/admin/affiliates/payouts?tab=failed", tone: "danger" as const },
    ],
  }
}

// --- Support center -------------------------------------------------------------------------

export async function supportCenter(days: number) {
  const [[row], [resp]] = await Promise.all([
    q(
      `select
        count(*) filter (where status = 'open') as open,
        count(*) filter (where status = 'open' and priority) as urgent,
        count(*) filter (where status = 'open' and not exists (select 1 from support_messages m where m."ticketId" = t.id and m."fromStaff")) as unanswered,
        count(*) filter (where status = 'waiting') as waiting,
        count(*) filter (where "createdAt" > now() - make_interval(days => $1::int)) as received,
        min("lastMessageAt") filter (where status = 'open') as oldest
      from support_tickets t`,
      [days]
    ),
    // First reply time: from the request to the first answer from the team, over the last 30 days.
    q(
      `select avg(extract(epoch from (f.first - t."createdAt"))) as seconds, count(*) as answered
       from support_tickets t
       join lateral (select min(m."createdAt") as first from support_messages m where m."ticketId" = t.id and m."fromStaff") f on f.first is not null
       where t."createdAt" > now() - interval '30 days'`
    ),
  ])
  return {
    open: n(row.open),
    urgent: n(row.urgent),
    unanswered: n(row.unanswered),
    waiting: n(row.waiting),
    received: n(row.received),
    oldestOpen: date(row.oldest)?.toISOString() ?? null,
    avgFirstReplySeconds: resp?.seconds == null ? null : Math.round(Number(resp.seconds)),
    answered30d: n(resp?.answered),
    inbox: supportInbox(),
  }
}

// --- System health -------------------------------------------------------------------------------

// Each check runs on its own: one that can't be read says so instead of
// pretending, and never stops the others.
export async function systemHealth(now = new Date()): Promise<{ checks: HealthCheck[]; checkedAt: string }> {
  const check = async (key: string, label: string, fn: () => Promise<HealthCheck>) => {
    try {
      return await fn()
    } catch {
      return key === "database" ? { key, label, status: "down" as const, detail: "Didn't answer" } : uncheckable(key, label)
    }
  }
  const checks = await Promise.all([
    check("app", "Web app", async () => {
      const [r] = await q(`select count(*) as samples, percentile_cont(0.95) within group (order by "durationMs") as p95 from request_timings where "createdAt" > now() - interval '1 hour'`)
      return appHealth({ samples: n(r.samples), p95: r.p95 == null ? null : Number(r.p95) })
    }),
    check("database", "Database", async () => {
      const t0 = performance.now()
      await q(`select 1`)
      const latencyMs = performance.now() - t0
      const [r] = await q(`select (select count(*) from pg_stat_activity where datname = current_database()) as c, current_setting('max_connections') as m`)
      return databaseHealth({ latencyMs, connections: n(r.c), maxConnections: n(r.m) })
    }),
    check("rithmic", "Rithmic sync", async () => {
      const [[r], beat] = await Promise.all([
        q(
          `select (select count(*) from rithmic_connections) as connections,
            (select max("createdAt") from sync_runs where trigger = 'auto') as last_auto,
            (select count(*) from sync_runs where broker = 'rithmic' and "createdAt" > now() - interval '24 hours') as runs,
            (select count(*) from sync_runs where broker = 'rithmic' and status = 'error' and "createdAt" > now() - interval '24 hours') as failed`
        ),
        readHeartbeat("rithmic_sync"),
      ])
      const lastAuto = date(r.last_auto)
      const lastPass = beat && (!lastAuto || beat.at > lastAuto) ? beat.at : lastAuto
      return rithmicHealth({ connections: n(r.connections), lastPass, lastPassOk: beat ? beat.ok : null, runs24h: n(r.runs), failed24h: n(r.failed) }, now)
    }),
    check("metatrader", "MT4 / MT5 sync", async () => {
      const [r] = await q(`select count(*) as c, max("lastSyncedAt") as freshest, count(*) filter (where "lastSyncStatus" = 'error') as failing from metatrader_connections`)
      return workerSyncHealth({ key: "metatrader", label: "MT4 / MT5 sync", noun: "MetaTrader", connections: n(r.c), freshest: date(r.freshest), failing: n(r.failing), staleMin: 15, downMin: 120 }, now)
    }),
    check("ninjatrader", "NinjaTrader / Tradovate", async () => {
      const [r] = await q(`select count(*) as c, max("lastSeenAt") as freshest, count(*) filter (where status = 'error') as failing from ninjatrader_connections`)
      return workerSyncHealth({ key: "ninjatrader", label: "NinjaTrader / Tradovate", noun: "NinjaTrader", connections: n(r.c), freshest: date(r.freshest), failing: n(r.failing), staleMin: 60, downMin: 24 * 60 }, now)
    }),
    check("email", "Email", async () => {
      const [r] = await q(
        `select count(*) filter (where status = 'sent' and "sentAt" > now() - interval '24 hours') as sent,
          count(*) filter (where status = 'failed' and "createdAt" > now() - interval '24 hours') as failed,
          count(*) filter (where status in ('queued', 'sending') and "createdAt" < now() - interval '10 minutes') as stuck
        from email_events where "createdAt" > now() - interval '7 days'`
      )
      return emailHealth({ configured: emailConfigured(), sent24h: n(r.sent), failed24h: n(r.failed), stuck: n(r.stuck) })
    }),
    check("payouts", "Payout processing", async () => {
      const beat = await readHeartbeat("affiliate_payouts")
      return payoutWorkerHealth({ lastRun: beat?.at ?? null, ok: beat ? beat.ok : null, failedSteps: beat?.failed }, now)
    }),
  ])
  return { checks, checkedAt: now.toISOString() }
}

// --- Notifications ---------------------------------------------------------------------------------

export async function notifications(can: Capabilities, prefs: AdminPrefs): Promise<{ items: (AdminNotice & { unread: boolean })[]; unread: number }> {
  const on = prefs.notify
  const jobs: Promise<AdminNotice[]>[] = []
  if (can.affiliates && on.payouts) {
    jobs.push(
      q<{ id: number; amount: string; asset: string | null; status: string; requestedAt: Date; firstName: string; lastName: string }>(
        `select p.id, p.amount, p.asset, p.status, p."requestedAt", a."firstName", a."lastName" from affiliate_payouts p join affiliates a on a.id = p."affiliateId"
         where p.status in ('pending', 'retry_required') order by p."requestedAt" desc limit 15`
      ).then((rows) =>
        rows.map((r) => ({
          key: `payout:${r.id}:${r.status}`,
          category: "payouts" as const,
          at: new Date(r.requestedAt).toISOString(),
          title: r.status === "pending" ? "Payout requires approval" : "Payout needs a retry",
          detail: `${usd(n(r.amount))}${r.asset ? ` ${r.asset}` : ""} · ${`${r.firstName} ${r.lastName}`.trim()}`,
          href: `/admin/affiliates/payouts/${r.id}`,
          tone: r.status === "pending" ? ("danger" as const) : ("warning" as const),
        }))
      )
    )
  }
  if (can.affiliates && on.affiliates) {
    jobs.push(
      q<{ id: number; firstName: string; lastName: string; createdAt: Date }>(`select id, "firstName", "lastName", "createdAt" from affiliates where status in ('pending', 'review') order by "createdAt" desc limit 15`).then((rows) =>
        rows.map((r) => ({ key: `aff_app:${r.id}`, category: "affiliates" as const, at: new Date(r.createdAt).toISOString(), title: "New affiliate application", detail: `${r.firstName} ${r.lastName}`.trim(), href: `/admin/affiliates/${r.id}`, tone: "primary" as const }))
      )
    )
    jobs.push(
      q<{ id: number; type: string; risk: string; createdAt: Date; firstName: string; lastName: string }>(
        `select s.id, s.type, s.risk, s."createdAt", a."firstName", a."lastName" from affiliate_fraud_signals s join affiliates a on a.id = s."affiliateId"
         where s.status in ('open', 'reviewing') and s.risk in ('high', 'medium') order by s."createdAt" desc limit 10`
      ).then((rows) =>
        rows.map((r) => ({ key: `fraud:${r.id}`, category: "affiliates" as const, at: new Date(r.createdAt).toISOString(), title: `${r.risk === "high" ? "High" : "Medium"}-risk affiliate signal`, detail: `${r.type.replace(/_/g, " ")} · ${`${r.firstName} ${r.lastName}`.trim()}`, href: "/admin/affiliates/fraud", tone: r.risk === "high" ? ("danger" as const) : ("warning" as const) }))
      )
    )
  }
  if (can.support && on.support) {
    jobs.push(
      q<{ id: number; subject: string; priority: boolean; lastMessageAt: Date }>(`select id, subject, priority, "lastMessageAt" from support_tickets where status = 'open' order by "lastMessageAt" desc limit 15`).then((rows) =>
        rows.map((r) => ({
          // A new message on the same request makes it new again.
          key: `ticket:${r.id}:${new Date(r.lastMessageAt).getTime()}`,
          category: "support" as const,
          at: new Date(r.lastMessageAt).toISOString(),
          title: r.priority ? "Priority support request waiting" : "Support request waiting for a reply",
          detail: `${ticketRef(r.id)} · ${r.subject}`,
          href: `/admin/support/${r.id}`,
          tone: r.priority ? ("danger" as const) : ("info" as const),
        }))
      )
    )
  }
  if (can.brokers && on.brokers) {
    jobs.push(
      q<{ broker: string; id: number; at: Date | null }>(
        `select 'rithmic' as broker, id, "lastSyncedAt" as at from rithmic_connections where "lastSyncStatus" = 'error'
         union all select 'metatrader', id, "lastSyncedAt" from metatrader_connections where "lastSyncStatus" = 'error'`
      ).then((rows) => {
        if (!rows.length) return []
        // One notice for the set of failing accounts; a different set is a new notice.
        const ids = rows.map((r) => `${r.broker[0]}${r.id}`).sort().join(",")
        const latest = rows.reduce<number>((max, r) => Math.max(max, r.at ? new Date(r.at).getTime() : 0), 0)
        return [{ key: `sync:${ids}`.slice(0, 120), category: "brokers" as const, at: new Date(latest || Date.now()).toISOString(), title: "Broker sync issue", detail: `${rows.length} account${rows.length === 1 ? "" : "s"} failing to sync`, href: "/admin/brokers", tone: "warning" as const }]
      })
    )
  }
  if (can.security && on.security) {
    jobs.push(
      q<{ ip: string; failures: string; last: Date }>(
        `select "ipAddress" as ip, count(*) as failures, max("createdAt") as last from security_events
         where type in ('sign_in_failed', 'two_factor_failed') and "createdAt" > now() - interval '24 hours' and "ipAddress" is not null
         group by 1 having count(*) >= 5 order by max("createdAt") desc limit 10`
      ).then((rows) =>
        rows.map((r) => ({ key: `sec:${r.ip}:${dayKey(new Date(r.last))}`.slice(0, 120), category: "security" as const, at: new Date(r.last).toISOString(), title: "Repeated failed sign-ins", detail: `${n(r.failures)} failures from ${r.ip} in 24 h`, href: `/admin/security?q=${encodeURIComponent(r.ip)}`, tone: "danger" as const }))
      )
    )
  }
  const settled = await Promise.allSettled(jobs)
  const items = settled
    .flatMap((s) => (s.status === "fulfilled" ? s.value : []))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40)
    .map((i) => ({ ...i, unread: isUnread(i, prefs) }))
  return { items, unread: items.filter((i) => i.unread).length }
}

// --- Search (the command palette) --------------------------------------------------------------------

export type SearchHit = { key: string; group: string; title: string; detail: string; href: string }

export async function search(can: Capabilities, raw: string): Promise<SearchHit[]> {
  const term = raw.trim().slice(0, 100)
  if (term.length < 2) return []
  const p = like(term)
  const digits = /^#?\s*(?:po-?|t-?)?(\d{1,9})$/i.exec(term)?.[1]
  const num = digits ? Number(digits) : null
  const jobs: Promise<SearchHit[]>[] = []

  if (can.users) {
    jobs.push(
      q<{ id: string; name: string; email: string; createdAt: Date }>(`select id, name, email, "createdAt" from "user" where email ilike $1 or name ilike $1 or id = $2 order by "createdAt" desc limit 6`, [p, term]).then((rows) =>
        rows.map((r) => ({ key: `u:${r.id}`, group: "Users", title: r.name || r.email, detail: r.email, href: userHref(can, r.id, r.email) }))
      )
    )
  }
  if (can.support) {
    const id = ticketIdFromRef(term)
    jobs.push(
      (id != null
        ? q<{ id: number; subject: string; status: string; email: string | null }>(`select t.id, t.subject, t.status, coalesce(u.email, t.email) as email from support_tickets t left join "user" u on u.id = t."userId" where t.id = $1`, [id])
        : q<{ id: number; subject: string; status: string; email: string | null }>(
            `select t.id, t.subject, t.status, coalesce(u.email, t.email) as email from support_tickets t left join "user" u on u.id = t."userId"
             where t.subject ilike $1 or t.email ilike $1 or u.email ilike $1 order by t."lastMessageAt" desc limit 5`,
            [p]
          )
      ).then((rows) => rows.map((r) => ({ key: `t:${r.id}`, group: "Support requests", title: `${ticketRef(r.id)} · ${r.subject}`, detail: [r.email, r.status].filter(Boolean).join(" · "), href: `/admin/support/${r.id}` })))
    )
  }
  if (can.affiliates) {
    jobs.push(
      q<{ id: number; amount: string; status: string; methodLabel: string; firstName: string; lastName: string }>(
        `select p.id, p.amount, p.status, p."methodLabel", a."firstName", a."lastName" from affiliate_payouts p join affiliates a on a.id = p."affiliateId"
         where ($2::int is not null and p.id = $2::int) or p."transactionHash" = $3 or a.email ilike $1 or (a."firstName" || ' ' || a."lastName") ilike $1
         order by p."requestedAt" desc limit 5`,
        [p, num, term]
      ).then((rows) => rows.map((r) => ({ key: `p:${r.id}`, group: "Payouts", title: `Payout #${r.id} · ${usd(n(r.amount))}`, detail: `${`${r.firstName} ${r.lastName}`.trim()} · ${label(r.status)} · ${r.methodLabel}`, href: `/admin/affiliates/payouts/${r.id}` })))
    )
    jobs.push(
      q<{ id: number; firstName: string; lastName: string; email: string; code: string; status: string }>(
        `select id, "firstName", "lastName", email, code, status from affiliates where email ilike $1 or code ilike $1 or ("firstName" || ' ' || "lastName") ilike $1 order by "createdAt" desc limit 5`,
        [p]
      ).then((rows) => rows.map((r) => ({ key: `a:${r.id}`, group: "Affiliates", title: `${r.firstName} ${r.lastName}`.trim(), detail: `${r.email} · ${r.code} · ${r.status}`, href: `/admin/affiliates/${r.id}` })))
    )
  }
  if (can.billing) {
    jobs.push(
      q<{ id: number; userId: string | null; email: string; plan: string; status: string }>(
        `select s.id, s."userId", coalesce(u.email, s.email) as email, s.plan, s.status from subscriptions s left join "user" u on u.id = s."userId"
         where s.email ilike $1 or u.email ilike $1 or s."whopMembershipId" = $2 order by s."updatedAt" desc limit 5`,
        [p, term]
      ).then((rows) => rows.map((r) => ({ key: `s:${r.id}`, group: "Billing", title: r.email, detail: `${r.plan} · ${r.status.replace("_", " ")}`, href: userHref(can, r.userId, r.email) })))
    )
  }
  if (can.brokers) {
    // Account names and logins only — never credentials.
    jobs.push(
      q<{ kind: string; id: number; userId: string; email: string | null; label: string }>(
        `select * from (
           select 'Rithmic' as kind, r.id, r."userId", u.email, coalesce(r."accountName", r."systemName") as label from rithmic_connections r left join "user" u on u.id = r."userId"
             where r."accountName" ilike $1 or r."systemName" ilike $1 or u.email ilike $1
           union all
           select upper(coalesce(m.platform, 'mt5')), m.id, m."userId", u.email, m.server || ' · ' || m.login from metatrader_connections m left join "user" u on u.id = m."userId"
             where m.login ilike $1 or m.server ilike $1 or u.email ilike $1
         ) c limit 6`,
        [p]
      ).then((rows) => rows.map((r) => ({ key: `b:${r.kind}:${r.id}`, group: "Broker accounts", title: `${r.kind} · ${r.label}`, detail: r.email ?? "", href: userHref(can, r.userId, r.email) })))
    )
    jobs.push(
      q<{ id: number; userId: string; email: string | null; name: string; phase: string }>(
        `select pa.id, pa."userId", u.email, ta.name, pa.phase from prop_account pa join trading_accounts ta on ta.id = pa."accountId" left join "user" u on u.id = pa."userId"
         where ta.name ilike $1 or u.email ilike $1 order by pa.id desc limit 5`,
        [p]
      ).then((rows) => rows.map((r) => ({ key: `pa:${r.id}`, group: "Prop accounts", title: r.name, detail: [r.email, r.phase].filter(Boolean).join(" · "), href: userHref(can, r.userId, r.email) })))
    )
  }
  if (can.userDetail) {
    // A trade by its number, or the newest trades in a symbol.
    jobs.push(
      (num != null
        ? q<{ id: number; userId: string; email: string | null; symbol: string; side: string; pnl: string; createdAt: Date }>(
            `select t.id, t."userId", u.email, t.symbol, t.side, t.pnl, t."createdAt" from trades t left join "user" u on u.id = t."userId" where t.id = $1`,
            [num]
          )
        : /^[a-z0-9./!:_-]{2,20}$/i.test(term)
          ? q<{ id: number; userId: string; email: string | null; symbol: string; side: string; pnl: string; createdAt: Date }>(
              `select t.id, t."userId", u.email, t.symbol, t.side, t.pnl, t."createdAt" from trades t left join "user" u on u.id = t."userId" where t.symbol ilike $1 order by t."createdAt" desc limit 5`,
              [`${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]
            )
          : Promise.resolve([])
      ).then((rows) => rows.map((r) => ({ key: `tr:${r.id}`, group: "Trades", title: `#${r.id} · ${r.symbol} ${r.side}`, detail: `${r.email ?? ""} · P&L ${usd(n(r.pnl))}`, href: `/admin/users/${r.userId}` })))
    )
  }
  if (can.announcements) {
    jobs.push(
      q<{ id: number; message: string; active: boolean }>(`select id, message, active from announcements where message ilike $1 order by "createdAt" desc limit 4`, [p]).then((rows) =>
        rows.map((r) => ({ key: `an:${r.id}`, group: "Announcements", title: r.message.slice(0, 90), detail: r.active ? "Active" : "Inactive", href: "/admin/announcements" }))
      )
    )
  }
  if (can.audit) {
    const actions = Object.entries(ACTION_LABELS)
      .filter(([, text]) => text.toLowerCase().includes(term.toLowerCase()))
      .map(([action]) => action)
    jobs.push(
      q<{ id: number; actorEmail: string; action: string; createdAt: Date }>(
        `select id, "actorEmail", action, "createdAt" from admin_audit_log where "actorEmail" ilike $1 or action ilike $1 or action = any($2) order by "createdAt" desc limit 5`,
        [p, actions]
      ).then((rows) => rows.map((r) => ({ key: `au:${r.id}`, group: "Audit log", title: ACTION_LABELS[r.action] ?? r.action, detail: `${r.actorEmail} · ${new Date(r.createdAt).toISOString().slice(0, 10)}`, href: `/admin/audit?actor=${encodeURIComponent(r.actorEmail)}` })))
    )
  }
  const settled = await Promise.allSettled(jobs)
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))
}
