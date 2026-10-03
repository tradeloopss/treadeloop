import type { Metadata } from "next"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { loadPayoutPage } from "@/lib/affiliates/payout-view"
import { PAYOUT_STATUS_LABELS, payoutInFlight, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { money } from "@/lib/affiliates/types"
import { getV2Config } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { AutoPayoutPanel } from "@/components/affiliate/payouts"
import { AvailableToWithdrawCard } from "@/components/affiliate/available-card"
import { PayoutDetailsProvider, PayoutFlow, PayoutHistoryList } from "@/components/affiliate/v2/payout-flow"
import { CardLink, PageFrame, V2Card, ghostBtnClass } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Payout" }

// The Payout page: ask for a payout (method → amount → what arrives → confirm)
// and follow the ones already asked for. Payout methods themselves are managed
// in the Wallet; this page only chooses one.
export default async function AffiliateV2Payouts({ searchParams }: { searchParams: Promise<{ tab?: string; stripe?: string; payout?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const [data, config] = await Promise.all([loadPayoutPage(affiliate), getV2Config()])
  if (!data) return null
  const { balances, payouts, limits } = data
  const history = sp.tab === "history"
  const inFlight = payouts.find((p) => payoutInFlight(p.status))
  const openId = Number(sp.payout)
  // Blocked only because a payout is already on its way (not paused, not on hold): say so, and offer to open it.
  const waiting = data.blocked != null && !data.settings.paused && !affiliate.fraudLock && !affiliate.payoutHold && affiliate.manualPayoutAllowed ? (inFlight ?? null) : null

  return (
    <PageFrame
      title={history ? "Payout History" : "Payout"}
      description={history ? "Every payout you've requested or received." : "Withdraw your earnings to your preferred method."}
      back={history ? { href: "/affiliate/v2/payouts", label: "Payout" } : undefined}
      action={
        payouts.length > 0 ? (
          <a href={affiliateHref("/affiliate/export/payouts")} className={ghostBtnClass}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        ) : undefined
      }
    >
      {sp.stripe === "return" && data.methods.some((m) => m.type === "stripe") && (
        <p role="status" className="v2-card px-4 py-3 text-sm">
          {data.methods.find((m) => m.type === "stripe")!.status === "active" ? "Your Stripe account is connected and ready to receive payouts." : "Stripe hasn't finished verifying your account yet. Its status updates as soon as it does."}
        </p>
      )}

      <PayoutDetailsProvider payouts={data.payoutViews} eta={data.program.payoutEta} instantTypes={data.instantTypes} instantUpTo={data.request.instantUpTo} supportHref="/affiliate/v2/support" methodsHref="/affiliate/v2/wallet/methods" initialId={Number.isInteger(openId) && openId > 0 ? openId : null}>
        {history ? (
          <V2Card title="All payouts" subtitle="Select one for its details.">
            <PayoutHistoryList payouts={data.payoutViews} />
          </V2Card>
        ) : (
          <>
            <PayoutFlow
              request={data.request}
              manageHref="/affiliate/v2/wallet/methods"
              inFlightId={waiting?.id ?? null}
              back={config.features.wallet ? { href: "/affiliate/v2/wallet", label: "Back to Wallet" } : { href: "/affiliate/v2", label: "Back to Dashboard" }}
              top={
                <AvailableToWithdrawCard
                  label="Available for Payout"
                  amount={balances.available}
                  arrival={data.arrival}
                  status={inFlight ? `Payout in progress: ${money(inFlight.amount)} · ${PAYOUT_STATUS_LABELS[inFlight.status as PayoutStatus] ?? inFlight.status}` : data.nextRun ? `Next automatic payout: ${money(data.nextRun.amount)}, on the next run` : null}
                  note={
                    <>
                      Minimum payout <span className="font-semibold text-white tabular-nums">{money(limits.min)}</span>
                      {limits.max != null && (
                        <>
                          {" "}
                          · up to <span className="font-semibold text-white tabular-nums">{money(limits.max)}</span> per payout
                        </>
                      )}
                    </>
                  }
                />
              }
              aside={
                <V2Card title="Payout History" action={payouts.length > 0 ? <CardLink href="/affiliate/v2/payouts?tab=history">View All</CardLink> : undefined}>
                  <PayoutHistoryList payouts={data.payoutViews} limit={5} />
                </V2Card>
              }
            />
            <AutoPayoutPanel auto={data.auto} />
          </>
        )}
      </PayoutDetailsProvider>
    </PageFrame>
  )
}
