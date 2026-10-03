import type { Metadata } from "next"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { loadPayoutPage } from "@/lib/affiliates/payout-view"
import { money } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { Kpi, KpiGrid, linkButtonClass } from "@/components/affiliate/ui"
import { AddPayoutMethodButton, AutoPayoutPanel, MethodCards, PayoutHistory, RequestPayout } from "@/components/affiliate/payouts"
import { affiliateHref } from "@/lib/urls"

export const metadata: Metadata = { title: "Payouts" }

export default async function AffiliatePayoutsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  // Balances, methods, payouts and every eligibility check, prepared the same
  // way as on the V2 Wallet and Payouts pages (lib/affiliates/payout-view).
  const data = await loadPayoutPage(affiliate)
  if (!data) return null
  const { balances, methods, methodViews, payouts, program, inProgress, config, autoOn } = data

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Manage your payout methods and withdraw your affiliate earnings."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {payouts.length > 0 && (
              <a href={affiliateHref("/affiliate/export/payouts")} className={linkButtonClass}>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            )}
            <AddPayoutMethodButton config={config} />
          </div>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {sp.stripe === "return" && methods.some((m) => m.type === "stripe") && (
          <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
            {methods.find((m) => m.type === "stripe")!.status === "active" ? "Your Stripe account is connected and ready to receive payouts." : "Stripe hasn't finished verifying your account yet. Its status below updates as soon as it does — use Verify to continue if Stripe needs more from you."}
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <section className="rounded-xl border bg-card p-5 lg:col-span-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Available to withdraw</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{money(balances.available)}</p>
            <div className="mt-4">
              <RequestPayout {...data.request} />
            </div>
          </section>
          <KpiGrid className="lg:col-span-2">
            <Kpi label="Pending" value={money(balances.pending)} note={`Clears after the ${program.holdDays}-day hold`} />
            <Kpi label="Processing" value={money(balances.processing)} note={inProgress ? "A payout is on its way" : "None right now"} />
            <Kpi label="Lifetime earned" value={money(balances.lifetimeEarned)} note="All time" />
            <Kpi label="Lifetime paid" value={money(balances.lifetimePaid)} note="All time" />
          </KpiGrid>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Payout methods</h2>
          <MethodCards methods={methodViews} config={config} autoPayoutOn={autoOn} />
        </section>

        <AutoPayoutPanel auto={data.auto} />

        <section id="payout-history" className="flex scroll-mt-4 flex-col gap-3">
          <h2 className="text-sm font-semibold">Payout history</h2>
          <PayoutHistory payouts={data.payoutViews} />
        </section>
      </div>
    </div>
  )
}
