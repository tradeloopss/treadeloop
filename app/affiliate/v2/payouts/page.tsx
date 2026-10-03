import type { Metadata } from "next"
import { Banknote, Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { loadPayoutPage } from "@/lib/affiliates/payout-view"
import { PAYOUT_STATUS_LABELS, payoutInFlight, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { money } from "@/lib/affiliates/types"
import { affiliateHref } from "@/lib/urls"
import { AutoPayoutPanel, PayoutHistory } from "@/components/affiliate/payouts"
import { MethodMark } from "@/components/affiliate/payout-method-dialog"
import { AvailableToWithdrawCard } from "@/components/affiliate/available-card"
import { EmptyState, LinkTabs, MetricCard, PageFrame, StatusChip, V2Card, fmtDate, ghostBtnClass } from "@/components/affiliate/v2/ui"
import { CircleDollarSign, Clock, Hourglass } from "lucide-react"

export const metadata: Metadata = { title: "Payouts" }

export default async function AffiliateV2Payouts({ searchParams }: { searchParams: Promise<{ tab?: string; withdraw?: string; stripe?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const data = await loadPayoutPage(affiliate)
  if (!data) return null
  const { balances, payouts } = data
  const history = sp.tab === "history"
  const inFlight = payouts.find((p) => payoutInFlight(p.status))

  return (
    <PageFrame
      title="Payouts"
      description="Withdraw your earnings and follow every payout."
      action={
        payouts.length > 0 ? (
          <a href={affiliateHref("/affiliate/export/payouts")} className={ghostBtnClass}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        ) : undefined
      }
    >
      <LinkTabs
        current={history ? "history" : "payouts"}
        tabs={[
          { key: "payouts", label: "Payouts", href: "/affiliate/v2/payouts" },
          { key: "history", label: "History", href: "/affiliate/v2/payouts?tab=history", count: payouts.length },
        ]}
      />

      {sp.stripe === "return" && data.methods.some((m) => m.type === "stripe") && (
        <p role="status" className="v2-card px-4 py-3 text-sm">
          {data.methods.find((m) => m.type === "stripe")!.status === "active" ? "Your Stripe account is connected and ready to receive payouts." : "Stripe hasn't finished verifying your account yet. Its status updates as soon as it does."}
        </p>
      )}

      {history ? (
        <V2Card title="Payout history" subtitle="Every payout you've requested or received, with its status and transaction.">
          <PayoutHistory payouts={data.payoutViews} />
        </V2Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
            <AvailableToWithdrawCard
              request={data.request}
              amount={balances.available}
              arrival={data.arrival}
              status={inFlight ? `Payout in progress: ${money(inFlight.amount)} · ${PAYOUT_STATUS_LABELS[inFlight.status as PayoutStatus] ?? inFlight.status}` : data.nextRun ? `Next automatic payout: ${money(data.nextRun.amount)}, on the next run` : null}
              autoOpen={sp.withdraw === "1"}
              className="lg:col-span-2"
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <MetricCard icon={Hourglass} label="Pending" value={money(balances.pending)} sub={`Clears after the ${data.program.holdDays}-day hold`} />
              <MetricCard icon={Clock} label="Processing" value={money(balances.processing)} sub={data.inProgress ? "A payout is on its way" : "None right now"} />
              <MetricCard icon={CircleDollarSign} label="Lifetime paid" value={money(balances.lifetimePaid)} sub="All time" className="col-span-2 lg:col-span-1" />
            </div>
          </div>

          <AutoPayoutPanel auto={data.auto} />

          <V2Card title="Recent payouts" action={payouts.length > 5 ? <a href={affiliateHref("/affiliate/v2/payouts?tab=history")} className="text-xs font-medium text-primary hover:underline">View all</a> : undefined}>
            {payouts.length === 0 ? (
              <EmptyState icon={Banknote} title="No payouts yet">Once you have enough available, request a payout and follow it here.</EmptyState>
            ) : (
              <ul className="divide-y">
                {payouts.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background/50">
                      <MethodMark type={p.methodType} className="size-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tabular-nums">{money(p.amount)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {fmtDate(p.completedAt ?? p.requestedAt)} · {p.methodLabel}
                      </span>
                    </span>
                    <StatusChip status={p.status} kind="payout" />
                  </li>
                ))}
              </ul>
            )}
          </V2Card>
        </>
      )}
    </PageFrame>
  )
}
