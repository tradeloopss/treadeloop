import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { couponsWithStats } from "@/lib/affiliates/queries"
import { PageHeader } from "@/components/page-header"
import { CouponsList } from "@/components/affiliate/coupons"

export const metadata: Metadata = { title: "Coupons" }

// Read-only: the codes the affiliate has been given (their permanent one, and
// the coupons an admin generated for them). Nothing here creates or changes one.
export default async function AffiliateCouponsPage() {
  const { affiliate } = await requireAffiliate()
  const coupons = await couponsWithStats(affiliate.id)
  return (
    <div>
      <PageHeader title="Coupons" description="Discount codes that credit the sale to you." />
      <div className="p-4 sm:p-6">
        <CouponsList
          coupons={coupons.map((c) => ({
            id: c.id,
            code: c.code,
            percent: Number(c.discountValue),
            durationMonths: c.durationMonths,
            plan: c.plan,
            campaign: c.campaign?.name ?? null,
            usageLimit: c.usageLimit,
            uses: c.uses,
            expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
            status: c.status,
            permanent: c.permanent,
            stats: { customers: c.stats.customers, revenue: c.stats.revenue, commission: c.stats.commission },
          }))}
        />
      </div>
    </div>
  )
}
