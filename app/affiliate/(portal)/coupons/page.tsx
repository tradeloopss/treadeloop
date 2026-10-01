import type { Metadata } from "next"
import { couponAccess } from "@/lib/affiliates/engine"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { getProgram } from "@/lib/affiliates/program"
import { campaignsWithStats, couponsWithStats } from "@/lib/affiliates/queries"
import { PageHeader } from "@/components/page-header"
import { CouponsManager } from "@/components/affiliate/coupons"

export const metadata: Metadata = { title: "Coupons" }

export default async function AffiliateCouponsPage() {
  const { affiliate } = await requireAffiliate()
  const [coupons, campaigns, program] = await Promise.all([couponsWithStats(affiliate.id), campaignsWithStats(affiliate.id), getProgram()])
  const access = couponAccess(affiliate, program)
  return (
    <div>
      <PageHeader title="Coupons" description="Discount codes that credit the sale to you." />
      <div className="p-4 sm:p-6">
        <CouponsManager
          enabled={access.enabled}
          maxPercent={access.maxPercent}
          campaigns={campaigns.filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name }))}
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
