import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { couponsWithStats } from "@/lib/affiliates/queries"
import { CouponCards, RequestCouponButton } from "@/components/affiliate/v2/coupons"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Coupons" }

// The affiliate's codes (their permanent one, and those the team generated
// for them). Read-only; a new one is requested, never created here.
export default async function AffiliateV2Coupons({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const coupons = await couponsWithStats(affiliate.id)
  return (
    <PageFrame title="Coupons" description="Discount codes that credit the sale to you." action={<RequestCouponButton autoOpen={sp.request === "1"} />}>
      <CouponCards
        coupons={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          discountType: c.discountType,
          discountValue: Number(c.discountValue),
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
      <p className="text-xs text-muted-foreground">Coupons are created by the TradeLoop team. Use &ldquo;Request a coupon&rdquo; to ask for one for a campaign.</p>
    </PageFrame>
  )
}
