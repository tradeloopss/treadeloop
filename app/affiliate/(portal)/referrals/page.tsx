import type { Metadata } from "next"
import Link from "next/link"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { PAGE_SIZE, campaignsWithStats, referralsPage, totalsFor } from "@/lib/affiliates/queries"
import { count, money } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { FilterSelect, Pager } from "@/components/admin/ui"
import { Kpi, KpiGrid, linkButtonClass } from "@/components/affiliate/ui"
import { ReferralsTable } from "@/components/affiliate/referrals-table"

export const metadata: Metadata = { title: "Referrals" }

const STATUSES: [string, string][] = [["", "All statuses"], ["signup", "Signed up"], ["trial", "Trial"], ["active", "Active"], ["cancelled", "Cancelled"], ["refunded", "Refunded"]]

export default async function AffiliateReferralsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; campaign?: string; source?: string; page?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const filters = {
    q: sp.q?.trim().slice(0, 24) || undefined,
    status: STATUSES.some(([v]) => v && v === sp.status) ? sp.status : undefined,
    campaign: Number(sp.campaign) > 0 ? Number(sp.campaign) : undefined,
    source: sp.source === "link" || sp.source === "coupon" ? sp.source : undefined,
    page: Math.max(1, Number(sp.page) || 1),
  }
  const [page, totals, campaigns] = await Promise.all([referralsPage(affiliate.id, filters), totalsFor(affiliate.id, null), campaignsWithStats(affiliate.id)])
  const filtered = !!(filters.q || filters.status || filters.campaign || filters.source)

  return (
    <div>
      <PageHeader
        title="Referrals"
        description="Everyone who signed up through you. Select a row for its full history."
        action={
          <a href={`/affiliate/export/referrals${filters.status ? `?status=${filters.status}` : ""}`} className={linkButtonClass}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <KpiGrid>
          <Kpi label="Total referrals" value={count(totals.signups)} />
          <Kpi label="Trials started" value={count(totals.trials)} />
          <Kpi label="Paying customers" value={count(totals.customers)} />
          <Kpi label="Customer revenue" value={money(totals.revenue)} />
        </KpiGrid>

        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Search by reference
            <input name="q" defaultValue={filters.q ?? ""} placeholder="TL-48213" className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
          </label>
          <FilterSelect name="status" label="Status" defaultValue={filters.status} options={STATUSES} />
          <FilterSelect name="source" label="Source" defaultValue={filters.source} options={[["", "Link or coupon"], ["link", "Link"], ["coupon", "Coupon"]]} />
          {campaigns.length > 0 && <FilterSelect name="campaign" label="Campaign" defaultValue={filters.campaign ? String(filters.campaign) : ""} options={[["", "All campaigns"], ...campaigns.map((c) => [String(c.id), c.name] as [string, string])]} />}
          <button type="submit" className="h-9 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Apply
          </button>
          {filtered && (
            <Link href="/affiliate/referrals" className="h-9 content-center text-sm text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </form>

        <ReferralsTable filtered={filtered} rows={page.rows.map((r) => ({ id: r.id, publicId: r.publicId, status: r.status, source: r.source, plan: r.plan, billing: r.billing, country: r.country, campaign: r.campaign, revenue: r.revenue, commission: r.commission, createdAt: r.createdAt.toISOString() }))} />
        {page.total > PAGE_SIZE && <Pager page={page.page} total={page.total} pageSize={PAGE_SIZE} params={{ q: filters.q, status: filters.status, source: filters.source, campaign: filters.campaign ? String(filters.campaign) : undefined }} />}
      </div>
    </div>
  )
}
