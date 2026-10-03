import type { Metadata } from "next"
import { Download, Search } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { PAGE_SIZE, defaultLink, referralsPage, type ReferralFilters } from "@/lib/affiliates/queries"
import { affiliateHref } from "@/lib/urls"
import { ReferralList } from "@/components/affiliate/v2/referrals"
import { LinkTabs, PageFrame, Pagination, V2Card, ghostBtnClass } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Referrals" }

const TABS: { key: string; label: string; filter: Partial<ReferralFilters> }[] = [
  { key: "all", label: "All referrals", filter: {} },
  { key: "pending", label: "Pending", filter: { statuses: ["signup", "trial"] } },
  { key: "active", label: "Active", filter: { status: "active" } },
  { key: "paid", label: "Paid", filter: { paid: true } },
  { key: "cancelled", label: "Cancelled", filter: { statuses: ["cancelled", "refunded"] } },
]

export default async function AffiliateV2Referrals({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string; open?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0]
  const q = (sp.q ?? "").trim().slice(0, 24)
  const page = Math.max(1, Number(sp.page) || 1)
  const [list, link] = await Promise.all([referralsPage(affiliate.id, { ...tab.filter, q: q || undefined, page }), defaultLink(affiliate.id)])
  const href = (p: number, t = tab.key) => `/affiliate/v2/referrals?${new URLSearchParams(Object.entries({ tab: t === "all" ? "" : t, q, page: p > 1 ? String(p) : "" }).filter(([, v]) => v))}`

  return (
    <PageFrame
      title="Referrals"
      description="Everyone who signed up through you."
      action={
        <a href={affiliateHref("/affiliate/export/referrals")} className={ghostBtnClass}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      }
    >
      <V2Card>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <LinkTabs current={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: href(1, t.key) }))} />
          <form method="get" action={affiliateHref("/affiliate/v2/referrals")} className="flex w-full items-center gap-2 rounded-xl border bg-background/50 px-3 lg:w-72">
            {tab.key !== "all" && <input type="hidden" name="tab" value={tab.key} />}
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Find a referral (TL-…)" aria-label="Find a referral by its ID" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </form>
        </div>
        <ReferralList
          rows={list.rows.map((r) => ({ id: r.id, publicId: r.publicId, status: r.status, source: r.source, plan: r.plan, billing: r.billing, campaign: r.campaign, revenue: r.revenue, commission: r.commission, createdAt: r.createdAt.toISOString(), firstPaymentAt: r.firstPaymentAt ? r.firstPaymentAt.toISOString() : null }))}
          openId={sp.open ?? null}
          referralUrl={buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })}
          filtered={tab.key !== "all" || !!q}
        />
        <Pagination page={list.page} total={list.total} size={PAGE_SIZE} href={(p) => href(p)} />
      </V2Card>
      <p className="text-xs text-muted-foreground">Customers are shown by their referral ID — TradeLoop never shares who they are.</p>
    </PageFrame>
  )
}
