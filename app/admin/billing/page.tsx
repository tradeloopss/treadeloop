import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { getBillingRisks, getRevenue, getRevenueRetention, listSubscriptions } from "@/lib/admin/metrics"
import { listAffiliates, listPayments, listPromoCodes, load, PAYMENT_STATUSES, type PaymentStatus } from "@/lib/admin/whop"
import { WhopUnavailable } from "@/components/admin/whop-notice"
import { DeletePromoButton, PromoCodeForm, RefundButton, RetryPaymentButton } from "@/components/admin/whop-controls"
import { rowGrantsAccess } from "@/lib/subscription"
import { RevokeGrantButton } from "@/components/admin/row-actions"
import { AdminPageHeader, EmptyRow, Panel, StatePill, StatRow, StatTile, fmtAgo, fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

const TABS: [string, string][] = [
  ["", "All"],
  ["access", "Has access"],
  ["trialing", "Trialing"],
  ["canceled", "Canceled"],
  ["admin", "Admin grants"],
  ["pending", "Abandoned checkouts"],
]

const PAYMENT_TABS: [string, string][] = [["", "Recent"], ["paid", "Paid"], ["open", "Failed / retrying"], ["uncollectible", "Uncollectible"], ["void", "Voided"]]

export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ status?: string; payments?: string }> }) {
  const admin = await requireAdmin({ billing: ["view"] })
  const canManage = roleCan(admin.role, { billing: ["manage"] })
  const { status, payments: paymentsFilter } = await searchParams
  const paymentStatus = (PAYMENT_STATUSES as readonly string[]).includes(paymentsFilter ?? "") ? (paymentsFilter as PaymentStatus) : undefined
  const [revenue, subs, retention, risks, payments, promos, affiliates] = await Promise.all([
    getRevenue(),
    listSubscriptions(status),
    getRevenueRetention(),
    getBillingRisks(),
    load(() => listPayments({ status: paymentStatus, limit: 50 })),
    load(() => listPromoCodes()),
    load(() => listAffiliates()),
  ])

  return (
    <div>
      <AdminPageHeader
        title="Billing & revenue"
        description="From TradeLoop's subscription records. Revenue is estimated at list price."
        action={
          <a href="https://whop.com/dashboard" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            Open Whop dashboard <ExternalLink className="size-3.5" />
          </a>
        }
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Estimated MRR" value={fmtMoney(revenue.mrr)} note={`${revenue.paying} paying subscriber${revenue.paying === 1 ? "" : "s"}`} />
          <StatTile label="Estimated ARR" value={fmtMoney(revenue.arr)} note="MRR × 12" />
          <StatTile label="Churn, last 30 days" value={fmtPercent(revenue.churnRate)} note={`${revenue.churned30d} canceled or expired`} />
          <StatTile label="ARPU" value={revenue.arpu == null ? "—" : fmtMoney(revenue.arpu)} note="per paying user / month" />
          <StatTile label="Estimated LTV" value={revenue.ltv == null ? "—" : fmtMoney(revenue.ltv)} note={revenue.ltv == null ? "needs churn history" : "ARPU ÷ monthly churn"} />
        </StatRow>
        <StatRow>
          <StatTile label="On free trial" value={fmtNumber(revenue.trialing)} note="not yet counted in MRR" />
          <StatTile label="Admin grants" value={fmtNumber(revenue.granted)} note="access with no payment" />
          <StatTile label="Abandoned checkouts" value={fmtNumber(revenue.abandonedCheckouts7d)} note="started in the last 7 days" />
          <StatTile
            label="Net revenue retention"
            value={fmtPercent(retention.nrr)}
            note={retention.cohort ? `${retention.cohort} paying 30 days ago · ${retention.churned} churned · ${retention.expanded} upgraded` : "needs 30 days of history"}
          />
          <StatTile
            label="Pro / Essential"
            value={`${fmtNumber(revenue.byPlan.pro?.paying ?? 0)} / ${fmtNumber(revenue.byPlan.essential?.paying ?? 0)}`}
            note={`paying · ${(revenue.byPlan.pro?.trialing ?? 0) + (revenue.byPlan.essential?.trialing ?? 0)} trialing`}
          />
        </StatRow>

        {risks.length > 0 && (
          <Panel title={`At risk (${risks.length})`} description="Renewals Whop couldn't collect, and trials ending within 3 days.">
            <ul className="divide-y text-sm">
              {risks.map((r) => (
                <li key={`${r.email}-${r.status}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    {r.userId ? <Link href={`/admin/users/${r.userId}`} className="hover:text-primary">{r.email}</Link> : r.email}
                    <span className="ml-2 text-muted-foreground capitalize">{r.plan}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.status === "past_due" ? "payment failed" : `trial ends ${fmtDate(r.currentPeriodEnd)}`}
                    <StatePill state={r.status} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel
          title="Payments"
          description="Charges as Whop records them, newest first. Refunds go back to the card; a retry asks Whop to charge again now instead of at its next scheduled attempt."
          action={
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_TABS.map(([value, label]) => (
                <Link key={value} href={`?${new URLSearchParams({ ...(status ? { status } : {}), ...(value ? { payments: value } : {}) })}`} className={cn("rounded-full border px-3 py-1 text-xs", (paymentsFilter ?? "") === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                  {label}
                </Link>
              ))}
            </div>
          }
        >
          {!payments.ok ? (
            <WhopUnavailable error={payments.error} missingScope={payments.missingScope} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">When</th>
                    <th className="pb-2 font-medium">Customer</th>
                    <th className="pb-2 font-medium">Plan</th>
                    <th className="pb-2 pr-3 text-right font-medium">Amount</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.data.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground" title={fmtDateTime(p.createdAt)}>{fmtAgo(p.createdAt)}</td>
                      <td className="max-w-[220px] truncate py-2.5 pr-3">{p.email ?? "—"}</td>
                      <td className="max-w-[180px] truncate py-2.5 pr-3 text-muted-foreground">{p.planTitle ?? "—"}{p.promoCode ? ` · ${p.promoCode}` : ""}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {p.amount == null ? "—" : `${p.amount.toFixed(2)} ${p.currency.toUpperCase()}`}
                        {p.refundedAmount ? <span className="block text-xs text-muted-foreground">−{p.refundedAmount.toFixed(2)} refunded</span> : null}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="capitalize">{p.substatus.replaceAll("_", " ")}</span>
                        {p.failureMessage && <span className="block max-w-[260px] truncate text-xs text-[var(--loss)]" title={p.failureMessage}>{p.failureMessage}</span>}
                        {p.nextAttempt && <span className="block text-xs text-muted-foreground">next attempt {fmtDate(p.nextAttempt)}</span>}
                      </td>
                      <td className="py-2.5 text-right">
                        {canManage && (
                          <div className="flex justify-end gap-1.5">
                            {p.retryable && <RetryPaymentButton paymentId={p.id} email={p.email} />}
                            {p.refundable && <RefundButton paymentId={p.id} email={p.email} amount={p.amount} currency={p.currency} />}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {payments.data.length === 0 && <EmptyRow colSpan={6}>No payments here.</EmptyRow>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Promo codes" description="Discounts customers enter at Whop's checkout.">
            {!promos.ok ? (
              <WhopUnavailable error={promos.error} missingScope={promos.missingScope} />
            ) : (
              <>
                {canManage && (
                  <div className="mb-5 rounded-lg border bg-muted/30 p-4">
                    <PromoCodeForm />
                  </div>
                )}
                <ul className="divide-y text-sm">
                  {promos.data.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span>
                        <span className="font-mono font-medium">{c.code ?? c.id}</span>
                        <span className="ml-2 text-muted-foreground">
                          {c.promoType === "percentage" ? `${c.amountOff}% off` : `${c.amountOff} ${c.currency.toUpperCase()} off`}
                          {c.durationMonths ? ` for ${c.durationMonths} mo` : ""}
                          {c.newUsersOnly ? " · new customers" : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {c.uses} used{c.unlimitedStock ? "" : ` of ${c.stock}`}
                        {c.expiresAt ? ` · ends ${fmtDate(c.expiresAt)}` : ""}
                        <StatePill state={c.status === "active" ? "active" : "inactive"}>{c.status}</StatePill>
                        {canManage && <DeletePromoButton id={c.id} code={c.code} />}
                      </span>
                    </li>
                  ))}
                  {promos.data.length === 0 && <li className="py-6 text-center text-muted-foreground">No promo codes yet.</li>}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Affiliates" description="Partners referring customers through Whop. Payouts are settled by Whop.">
            {!affiliates.ok ? (
              <WhopUnavailable error={affiliates.error} missingScope={affiliates.missingScope} />
            ) : (
              <ul className="divide-y text-sm">
                {affiliates.data.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name ?? a.email ?? a.id}</span>
                      <span className="block text-xs text-muted-foreground">
                        {a.referrals} referral{a.referrals === 1 ? "" : "s"} · {a.activeMembers} active · joined {fmtDate(a.createdAt)}
                      </span>
                    </span>
                    <span className="text-right text-xs text-muted-foreground">
                      <span className="block text-sm font-medium text-foreground tabular-nums">{fmtMoney(a.revenueUsd)} revenue</span>
                      {fmtMoney(a.earningsUsd)} earned · {fmtMoney(a.mrrUsd)} MRR
                    </span>
                  </li>
                ))}
                {affiliates.data.length === 0 && <li className="py-6 text-center text-muted-foreground">No affiliates yet.</li>}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Subscriptions" description="Grant or revoke free access from a user's page. Pause, extend or cancel a Whop subscription from the user's page too.">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map(([value, label]) => (
              <Link
                key={value}
                href={value ? `?status=${value}` : "?"}
                className={cn("rounded-full border px-3 py-1 text-xs", (status ?? "") === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Plan</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Period end</th>
                  <th className="pb-2 font-medium">Updated</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 pr-3">
                      {s.userId ? (
                        <Link href={`/admin/users/${s.userId}`} className="hover:text-primary">{s.email || s.name}</Link>
                      ) : (
                        <span className="text-muted-foreground">{s.email || "unmatched payment"}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 capitalize">{s.plan}{s.billing ? ` · ${s.billing}` : ""}</td>
                    <td className="py-2.5 pr-3"><StatePill state={s.source === "admin" && s.status === "active" && !rowGrantsAccess(s) ? "expired" : s.status} /></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{s.source === "admin" ? "Admin grant" : "Whop"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtDate(s.currentPeriodEnd)}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtDate(s.updatedAt)}</td>
                    <td className="py-2.5 text-right">{canManage && s.source === "admin" && rowGrantsAccess(s) && <RevokeGrantButton subscriptionId={s.id} />}</td>
                  </tr>
                ))}
                {subs.length === 0 && <EmptyRow colSpan={7}>No subscriptions here.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
