import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { loadPayoutPage } from "@/lib/affiliates/payout-view"
import { ledgerPage } from "@/lib/affiliates/queries"
import { getV2Config, walletLedgerSummary } from "@/lib/affiliates/v2/server"
import { HIDE_BALANCE_COOKIE, feeRows, txCounts } from "@/lib/affiliates/v2/wallet"
import { affiliateHref } from "@/lib/urls"
import { PayoutMethodsSection, TransactionHistory, WalletBalances } from "@/components/affiliate/v2/wallet"
import { PageFrame, ghostBtnClass } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Wallet" }

// How many of the latest ledger rows the overview loads; the pills filter them
// in place, and "View All" opens the full list.
const RECENT = 60

// The Wallet manages and tracks: balances, payout methods, transaction history.
// It never asks for a payout — that is the Payout page, and there is no button
// for it anywhere here.
export default async function AffiliateV2Wallet({ searchParams }: { searchParams: Promise<{ withdraw?: string }> }) {
  const { affiliate } = await requireAffiliate()
  // An old link to "the wallet's withdraw window", or the Wallet switched off:
  // either way the Payout page is where that lives now.
  if ((await searchParams).withdraw === "1" || !(await getV2Config()).features.wallet) redirect(affiliateHref("/affiliate/v2/payouts"))
  // The same preparation as the Payout page (it also brings holds and payouts
  // up to date) — then the ledger, read after it so the two agree.
  const data = await loadPayoutPage(affiliate)
  if (!data) return null
  const [ledger, summary, jar] = await Promise.all([ledgerPage(affiliate.id, {}, RECENT), walletLedgerSummary(affiliate.id), cookies()])
  const { balances } = data
  const fees = feeRows(data.payoutViews)

  return (
    <PageFrame
      title="Wallet"
      description="Manage your balance, payout methods, and history."
      action={
        <a href={affiliateHref("/affiliate/export/commissions")} className={ghostBtnClass}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      }
    >
      <WalletBalances
        available={balances.available}
        pending={balances.pending}
        earned={balances.lifetimeEarned}
        paid={balances.lifetimePaid}
        processing={balances.processing}
        trend={{ values: summary.trend.points.map((p) => p.total), change: summary.trend.change }}
        initialHidden={jar.get(HIDE_BALANCE_COOKIE)?.value === "1"}
      />

      <div className="grid gap-4 lg:grid-cols-5 lg:items-start lg:gap-5">
        <div className="min-w-0 lg:col-span-2">
          <PayoutMethodsSection methods={data.methodViews} config={data.config} manageHref="/affiliate/v2/wallet/methods" />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <TransactionHistory
            rows={ledger.rows.map((r) => ({ id: r.id, type: r.type, status: r.status, amount: r.amount, baseAmount: r.baseAmount, ratePercent: r.ratePercent, ruleSource: r.ruleSource, holdUntil: r.holdUntil ? r.holdUntil.toISOString() : null, note: r.note, createdAt: r.createdAt.toISOString(), referral: r.referral, plan: r.plan, payoutId: r.payoutId }))}
            fees={fees}
            counts={txCounts(summary.byType, fees.length)}
            payouts={data.payoutViews}
            allHref="/affiliate/v2/wallet/transactions"
          />
        </div>
      </div>
    </PageFrame>
  )
}
