import type { Metadata } from "next"
import { Download } from "lucide-react"
import { releaseHolds } from "@/lib/affiliates/commissions"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { toPayoutView } from "@/lib/affiliates/payout-view"
import { PAGE_SIZE, ledgerPage, payoutsFor } from "@/lib/affiliates/queries"
import { getV2Config } from "@/lib/affiliates/v2/server"
import { TX_FILTERS, feeRows, txFilter } from "@/lib/affiliates/v2/wallet"
import { affiliateHref } from "@/lib/urls"
import { TransactionList, TransactionsEmpty } from "@/components/affiliate/v2/wallet"
import { LinkTabs, PageFrame, Pagination, V2Card, ghostBtnClass } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Transaction History" }

// Every transaction, a page at a time — what the Wallet's "View All" opens.
export default async function AffiliateV2WalletTransactions({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const filter = txFilter(sp.tab)
  const page = Math.max(1, Number(sp.page) || 1)
  await releaseHolds({ affiliateId: affiliate.id })
  const [payouts, ledger, config] = await Promise.all([payoutsFor(affiliate.id), filter.key === "fees" ? null : ledgerPage(affiliate.id, { types: filter.types ? [...filter.types] : undefined, page }), getV2Config()])
  const payoutViews = payouts.map(toPayoutView)
  // Fees come from the payouts they were taken from, not from the ledger.
  const fees = filter.key === "fees" ? feeRows(payoutViews) : []
  const total = ledger ? ledger.total : fees.length
  const rows = ledger ? ledger.rows.map((r) => ({ id: r.id, type: r.type, status: r.status, amount: r.amount, baseAmount: r.baseAmount, ratePercent: r.ratePercent, ruleSource: r.ruleSource, holdUntil: r.holdUntil ? r.holdUntil.toISOString() : null, note: r.note, createdAt: r.createdAt.toISOString(), referral: r.referral, plan: r.plan, payoutId: r.payoutId })) : fees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const href = (p: number, t: string = filter.key) => `/affiliate/v2/wallet/transactions${t === "all" && p <= 1 ? "" : `?${new URLSearchParams(Object.entries({ tab: t === "all" ? "" : t, page: p > 1 ? String(p) : "" }).filter(([, v]) => v))}`}`

  return (
    <PageFrame
      title="Transaction History"
      description="Everything that changed your balance."
      back={config.features.wallet ? { href: "/affiliate/v2/wallet", label: "Wallet" } : { href: "/affiliate/v2/payouts", label: "Payout" }}
      action={
        <a href={affiliateHref("/affiliate/export/commissions")} className={ghostBtnClass}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      }
    >
      <V2Card>
        <LinkTabs current={filter.key} tabs={TX_FILTERS.map((f) => ({ key: f.key, label: f.label, href: href(1, f.key) }))} className="mb-3" />
        {rows.length === 0 ? <TransactionsEmpty filter={filter.key} /> : <TransactionList rows={rows} payouts={payoutViews} />}
        {filter.key === "fees" && rows.length > 0 && <p className="mt-3 text-xs text-muted-foreground">A payout fee is taken from the payout itself — the amounts under Payouts already include it.</p>}
        <Pagination page={page} total={total} size={PAGE_SIZE} href={(p) => href(p)} />
      </V2Card>
    </PageFrame>
  )
}
