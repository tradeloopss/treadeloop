import type { Metadata } from "next"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor, releaseHolds } from "@/lib/affiliates/commissions"
import { getProgram } from "@/lib/affiliates/program"
import { payoutMethodsFor, payoutsFor } from "@/lib/affiliates/queries"
import { money } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { Kpi, KpiGrid, linkButtonClass } from "@/components/affiliate/ui"
import { PayoutHistory, PayoutMethods, RequestPayout } from "@/components/affiliate/payouts"

export const metadata: Metadata = { title: "Payouts" }

export default async function AffiliatePayoutsPage() {
  const { affiliate } = await requireAffiliate()
  await releaseHolds({ affiliateId: affiliate.id })
  const [balances, methods, payouts, program] = await Promise.all([balancesFor(affiliate.id), payoutMethodsFor(affiliate.id), payoutsFor(affiliate.id), getProgram()])
  const inProgress = payouts.some((p) => p.status === "pending" || p.status === "processing")
  // The same checks the server enforces when a request is submitted
  // (engine.validatePayoutRequest) — shown up front so the button explains itself.
  const blocked = affiliate.fraudLock
    ? "Payouts are paused while your account is under review."
    : affiliate.payoutHold
      ? "Payouts are on hold for your account. Contact affiliate support."
      : inProgress
        ? "You have a payout in progress. You can request another once it's paid."
        : null

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Withdraw your available commission."
        action={
          payouts.length > 0 ? (
            <a href="/affiliate/export/payouts" className={linkButtonClass}>
              <Download className="size-4" aria-hidden /> Export CSV
            </a>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-3">
          <section className="rounded-xl border bg-card p-5 lg:col-span-1">
            <p className="text-xs text-muted-foreground">Available to withdraw</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{money(balances.available)}</p>
            <div className="mt-4">
              <RequestPayout available={balances.available} minPayout={program.minPayout} methods={methods} blocked={blocked} eta={program.payoutEta} />
            </div>
          </section>
          <KpiGrid className="lg:col-span-2 lg:grid-cols-3">
            <Kpi label="Pending commission" value={money(balances.pending)} note={`Clears after the ${program.holdDays}-day hold`} />
            <Kpi label="Payouts in progress" value={money(balances.processing)} note={inProgress ? "Being reviewed or sent" : "None right now"} />
            <Kpi label="Paid out" value={money(balances.lifetimePaid)} note="All time" />
          </KpiGrid>
        </div>

        <PayoutMethods methods={methods} />

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Payout history</h2>
          <PayoutHistory payouts={payouts.map((p) => ({ id: p.id, amount: p.amount, methodType: p.methodType, methodLabel: p.methodLabel, status: p.status, failureReason: p.failureReason, requestedAt: p.requestedAt.toISOString(), processedAt: p.processedAt ? p.processedAt.toISOString() : null }))} />
        </section>
      </div>
    </div>
  )
}
