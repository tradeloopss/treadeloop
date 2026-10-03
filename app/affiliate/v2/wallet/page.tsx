import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { loadPayoutPage } from "@/lib/affiliates/payout-view"
import { PAGE_SIZE, ledgerPage } from "@/lib/affiliates/queries"
import { getV2Config } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { MethodCards } from "@/components/affiliate/payouts"
import { BalanceHero, PaymentMethodsGrid } from "@/components/affiliate/v2/wallet"
import { LedgerList } from "@/components/affiliate/v2/ledger"
import { LinkTabs, PageFrame, Pagination, V2Card, ghostBtnClass } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Wallet" }

const TABS = [
  { key: "all", label: "All", types: undefined },
  { key: "commission", label: "Commission", types: ["subscription", "bonus"] },
  { key: "withdrawals", label: "Withdrawals", types: ["payout"] },
  { key: "refunds", label: "Refunds", types: ["refund", "reversal"] },
  { key: "adjustments", label: "Adjustments", types: ["adjustment"] },
] as const

export default async function AffiliateV2Wallet({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string; withdraw?: string }> }) {
  const { affiliate } = await requireAffiliate()
  if (!(await getV2Config()).features.wallet) redirect(affiliateHref("/affiliate/v2/payouts"))
  const sp = await searchParams
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0]
  const page = Math.max(1, Number(sp.page) || 1)
  // The same preparation as the Payouts pages: balances, methods, every check.
  const [data, ledger] = await Promise.all([loadPayoutPage(affiliate), ledgerPage(affiliate.id, { types: tab.types ? [...tab.types] : undefined, page })])
  if (!data) return null
  const { balances } = data
  const href = (p: number, t = tab.key) => `/affiliate/v2/wallet?${new URLSearchParams(Object.entries({ tab: t === "all" ? "" : t, page: p > 1 ? String(p) : "" }).filter(([, v]) => v))}`

  return (
    <PageFrame
      title="Wallet"
      description="Manage your earnings and withdrawals."
      action={
        <a href={affiliateHref("/affiliate/export/commissions")} className={ghostBtnClass}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      }
    >
      <BalanceHero request={data.request} available={balances.available} pending={balances.pending} lifetime={balances.lifetimeEarned} processing={balances.processing} autoOpen={sp.withdraw === "1"} />

      <V2Card title="Payment methods" subtitle={`Payouts usually arrive in ${data.program.payoutEta}. Choose a method to withdraw, or add one.`}>
        <PaymentMethodsGrid request={data.request} offered={data.config.methods} methods={data.methodViews} config={data.config} />
      </V2Card>

      {data.methodViews.length > 0 && (
        <V2Card title="Your saved payout methods" subtitle="Set the default, rename, verify or remove a method.">
          <MethodCards methods={data.methodViews} config={data.config} autoPayoutOn={data.autoOn} />
        </V2Card>
      )}

      <V2Card title="Transactions" subtitle="Your balance is the sum of this ledger. Select a commission for its details.">
        <LinkTabs current={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: href(1, t.key) }))} className="mb-3" />
        <LedgerList
          rows={ledger.rows.map((r) => ({ id: r.id, type: r.type, status: r.status, amount: r.amount, baseAmount: r.baseAmount, ratePercent: r.ratePercent, ruleSource: r.ruleSource, holdUntil: r.holdUntil ? r.holdUntil.toISOString() : null, note: r.note, createdAt: r.createdAt.toISOString(), referral: r.referral, plan: r.plan }))}
          emptyTitle={tab.key === "all" ? "No transactions yet" : `No ${tab.label.toLowerCase()} yet`}
        />
        <Pagination page={ledger.page} total={ledger.total} size={PAGE_SIZE} href={(p) => href(p)} />
      </V2Card>
    </PageFrame>
  )
}
