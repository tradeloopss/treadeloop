import { and, eq, gte, lt, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateClicks, affiliateReferrals, affiliates } from "@/lib/db/schema"
import { getAppSetting, setAppSetting } from "@/lib/app-settings"
import { emailConfigured, sendEmail } from "@/lib/email"
import { getWhopClient } from "@/lib/whop"
import { money as whopMoney, whopAccountId } from "@/lib/admin/whop"
import { runAutoPayouts } from "./auto-payouts"
import { handleAffiliateRefund, releaseHolds } from "./commissions"
import { pruneUnfinishedMethods, trackPayouts } from "./payouts"
import { evaluateAffiliate } from "./fraud"
import { prefEnabled } from "./notify"
import { monthlyReport, type MonthlyReport } from "./queries"
import { count, money, pct } from "./types"

// The daily affiliate job (app/api/cron/affiliates). Every step is safe to run
// twice and none depends on another having succeeded.

// Refunds, straight from Whop. The refund webhook does this in real time when
// it is subscribed; this catches anything it missed. Same idempotency key as
// the webhook, so a refund seen by both is applied once.
export async function reconcileRefunds(days = 4): Promise<number> {
  const accountId = await whopAccountId()
  const page = await getWhopClient().refunds.list({ account_id: accountId, created_after: new Date(Date.now() - days * 86_400_000).toISOString(), first: 100 } as never)
  let applied = 0
  for (const r of (page as { data: Record<string, any>[] }).data) {
    if (!r?.id || !r.payment_id || r.status === "failed" || r.status === "canceled") continue
    const amount = whopMoney(r.amount) ?? whopMoney(r.original_amount) ?? 0
    if (!(amount > 0)) continue
    await handleAffiliateRefund({ eventId: String(r.id), paymentId: String(r.payment_id), refundAmount: amount, paymentTotal: 0, kind: "refund" })
    applied++
  }
  return applied
}

// Re-score affiliates with something new in the last two days.
async function evaluateActive(): Promise<number> {
  const since = new Date(Date.now() - 2 * 86_400_000)
  const rows = await db.selectDistinct({ id: affiliateReferrals.affiliateId }).from(affiliateReferrals).where(gte(affiliateReferrals.createdAt, since))
  for (const r of rows) await evaluateAffiliate(r.id)
  return rows.length
}

// Raw clicks are kept for 13 months — long enough for a year-over-year view.
async function pruneClicks(): Promise<void> {
  await db.delete(affiliateClicks).where(lt(affiliateClicks.createdAt, new Date(Date.now() - 400 * 86_400_000)))
}

export function monthlyReportText(firstName: string, r: MonthlyReport): string {
  const lines = [
    `Hi ${firstName},`,
    `Here's how ${r.label} went:`,
    [`Clicks: ${count(r.clicks)}`, `Sign-ups: ${count(r.signups)}`, `New paying customers: ${count(r.customers)}`, `Conversion: ${pct(r.clicks ? r.customers / r.clicks : 0)}`, `Customer revenue: ${money(r.revenue)}`, `Commission earned: ${money(r.commission)}`].join("\n"),
  ]
  if (r.topCampaigns.length) lines.push(`Top campaigns:\n${r.topCampaigns.map((c) => `• ${c.name} — ${count(c.clicks)} clicks, ${count(c.customers)} customers, ${money(c.commission)}`).join("\n")}`)
  return lines.join("\n\n")
}

const REPORT_KEY = "affiliate_monthly_report_sent"

// Once a month, early in the month, for the month just ended.
async function sendMonthlyReports(now: Date): Promise<number> {
  if (now.getUTCDate() > 5 || !emailConfigured()) return 0
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const tag = lastMonth.toISOString().slice(0, 7)
  if ((await getAppSetting<string>(REPORT_KEY)) === tag) return 0
  // Marked first: a crash mid-run must not mail everyone again tomorrow.
  await setAppSetting(REPORT_KEY, tag)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
  const rows = await db.select({ id: affiliates.id, email: affiliates.email, firstName: affiliates.firstName, notifications: affiliates.notifications }).from(affiliates).where(and(eq(affiliates.status, "approved"), sql`${affiliates.onboardedAt} is not null`))
  let sent = 0
  for (const a of rows) {
    if (!prefEnabled(a.notifications, "monthlyReport")) continue
    try {
      const report = await monthlyReport(a.id, lastMonth)
      if (report.clicks + report.signups + report.customers === 0 && report.commission === 0) continue
      await sendEmail({ to: a.email, subject: `Your ${report.label} affiliate report — TradeLoop`, text: `${monthlyReportText(a.firstName, report)}${base ? `\n\n${base}/affiliate/analytics` : ""}` })
      sent++
    } catch (e) {
      console.error("[affiliates] monthly report failed for", a.id, e instanceof Error ? e.message : e)
    }
  }
  return sent
}

// The payout half on its own, for a caller that wants it more often than once
// a day (the sync VPS): transaction tracking and the automatic payout worker.
export async function runPayoutJob(now = new Date()) {
  const out: Record<string, unknown> = {}
  for (const [name, fn] of [["holds", () => releaseHolds({ now })], ["tracking", () => trackPayouts({ olderThanSeconds: 0 })], ["autoPayouts", () => runAutoPayouts(now)]] as const) {
    try {
      out[name] = await fn()
    } catch (e) {
      out[name] = { error: e instanceof Error ? e.message : String(e) }
      console.error(`[affiliates] ${name} failed:`, e instanceof Error ? e.message : e)
    }
  }
  return out
}

export async function runDailyJob(now = new Date()) {
  const out: Record<string, unknown> = {}
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn()
    } catch (e) {
      out[name] = { error: e instanceof Error ? e.message : String(e) }
      console.error(`[affiliates] ${name} failed:`, e instanceof Error ? e.message : e)
    }
  }
  await step("holds", () => releaseHolds({ now }))
  await step("refunds", () => reconcileRefunds())
  // Payouts already sent are followed up first (this never stops, even while
  // payouts are paused); then new automatic payouts are created.
  await step("tracking", () => trackPayouts({ olderThanSeconds: 0 }))
  await step("autoPayouts", () => runAutoPayouts(now))
  await step("methods", () => pruneUnfinishedMethods())
  await step("risk", () => evaluateActive())
  await step("reports", () => sendMonthlyReports(now))
  await step("prune", () => pruneClicks())
  return out
}
