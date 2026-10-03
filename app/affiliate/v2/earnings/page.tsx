import type { Metadata } from "next"
import { CircleDollarSign, Download, Hourglass, Trophy, Wallet } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor, releaseHolds } from "@/lib/affiliates/commissions"
import { getProgram } from "@/lib/affiliates/program"
import { PAGE_SIZE, ledgerPage, monthlyStatements, performance } from "@/lib/affiliates/queries"
import { money, parseRange, signedMoney } from "@/lib/affiliates/types"
import { affiliateHref } from "@/lib/urls"
import { GlowChart } from "@/components/affiliate/v2/charts"
import { LedgerList } from "@/components/affiliate/v2/ledger"
import { LinkTabs, MetricCard, PageFrame, Pagination, RangeTabs, V2Card, ghostBtnClass } from "@/components/affiliate/v2/ui"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Earnings" }

const EARNING_TYPES = ["subscription", "bonus", "adjustment", "refund", "reversal"]
const TABS = [
  { key: "all", label: "All", statuses: undefined },
  { key: "pending", label: "Pending", statuses: ["pending"] },
  { key: "approved", label: "Approved", statuses: ["approved", "available"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "refunded", label: "Refunded", statuses: ["refunded", "reversed"] },
] as const

export default async function AffiliateV2Earnings({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string; range?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0]
  const page = Math.max(1, Number(sp.page) || 1)
  const range = parseRange(sp.range)
  await releaseHolds({ affiliateId: affiliate.id })
  const [balances, program, perf, ledger, statements] = await Promise.all([
    balancesFor(affiliate.id),
    getProgram(),
    performance(affiliate.id, range, affiliate.createdAt),
    ledgerPage(affiliate.id, { types: EARNING_TYPES, statuses: tab.statuses ? [...tab.statuses] : undefined, page }),
    monthlyStatements(affiliate.id),
  ])
  const href = (p: number, t: string = tab.key) => `/affiliate/v2/earnings?${new URLSearchParams(Object.entries({ tab: t === "all" ? "" : t, page: p > 1 ? String(p) : "", range: range === "30d" ? "" : range }).filter(([, v]) => v))}`
  const periodTotal = Math.round(perf.series.points.reduce((s, p) => s + p.commission, 0) * 100) / 100

  return (
    <PageFrame
      title="Earnings"
      description="Every commission, and where it is on its way to you."
      action={
        <a href={affiliateHref("/affiliate/export/commissions")} className={ghostBtnClass}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard icon={Trophy} label="Total earnings" value={money(balances.lifetimeEarned)} sub="All time" />
        <MetricCard icon={Wallet} label="Available" value={money(balances.available)} sub={`Minimum payout ${money(program.minPayout)}`} />
        <MetricCard icon={Hourglass} label="Pending" value={money(balances.pending)} sub={`In the ${program.holdDays}-day hold`} />
        <MetricCard icon={CircleDollarSign} label="Paid" value={money(balances.lifetimePaid)} sub={balances.processing > 0 ? `${money(balances.processing)} in progress` : "All time"} />
      </div>

      <V2Card
        title="Commission over time"
        subtitle={
          <>
            <span className="font-semibold text-foreground tabular-nums">{money(periodTotal)}</span> in this period
          </>
        }
        action={<RangeTabs range={range} path="/affiliate/v2/earnings" params={{ tab: tab.key === "all" ? undefined : tab.key }} className="max-sm:hidden" />}
      >
        <RangeTabs range={range} path="/affiliate/v2/earnings" params={{ tab: tab.key === "all" ? undefined : tab.key }} className="mb-3 self-start sm:hidden" />
        <GlowChart points={perf.series.points} unit={perf.series.unit} metric="commission" height="h-56 sm:h-64" />
      </V2Card>

      <V2Card title="Commission transactions" subtitle="A commission waits out its holding period in case of a refund, then becomes available to withdraw. Select one for its details.">
        <LinkTabs current={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: href(1, t.key) }))} className="mb-3" />
        <LedgerList
          rows={ledger.rows.map((r) => ({ id: r.id, type: r.type, status: r.status, amount: r.amount, baseAmount: r.baseAmount, ratePercent: r.ratePercent, ruleSource: r.ruleSource, holdUntil: r.holdUntil ? r.holdUntil.toISOString() : null, note: r.note, createdAt: r.createdAt.toISOString(), referral: r.referral, plan: r.plan }))}
          emptyTitle={tab.key === "all" ? "No earnings yet" : `Nothing ${tab.label.toLowerCase()} right now`}
        />
        <Pagination page={ledger.page} total={ledger.total} size={PAGE_SIZE} href={(p) => href(p)} />
      </V2Card>

      <V2Card title="Monthly statements" subtitle="The last 12 months, by the month each entry was recorded.">
        {statements.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">A month appears here once it has activity.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-3 pb-2 text-start font-medium">Month</th>
                  <th className="px-3 pb-2 text-end font-medium">Earned</th>
                  <th className="px-3 pb-2 text-end font-medium">Reversed</th>
                  <th className="px-3 pb-2 text-end font-medium">Net</th>
                  <th className="px-3 pb-2 text-end font-medium">Paid out</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {statements.map((s) => (
                  <tr key={s.month}>
                    <td className="px-3 py-2.5 font-medium">{new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{money(s.earned)}</td>
                    <td className={cn("px-3 py-2.5 text-end tabular-nums", s.reversed < 0 && "text-loss")}>{s.reversed ? signedMoney(s.reversed) : money(0)}</td>
                    <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{money(s.earned + s.reversed)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{money(s.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </V2Card>
    </PageFrame>
  )
}
