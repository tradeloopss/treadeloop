import type { Metadata } from "next"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateCoupons } from "@/lib/db/schema"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { buildTrackingUrl } from "@/lib/affiliates/engine"
import { SITE_URL } from "@/lib/affiliates/program"
import { defaultLink } from "@/lib/affiliates/queries"
import { ShareCenter } from "@/components/affiliate/v2/share"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Share center" }

export default async function AffiliateV2Share() {
  const { affiliate } = await requireAffiliate()
  const [link, [coupon]] = await Promise.all([
    defaultLink(affiliate.id),
    db
      .select({ code: affiliateCoupons.code, value: affiliateCoupons.discountValue, type: affiliateCoupons.discountType })
      .from(affiliateCoupons)
      .where(and(eq(affiliateCoupons.affiliateId, affiliate.id), eq(affiliateCoupons.permanent, true), eq(affiliateCoupons.status, "active"))),
  ])
  return (
    <PageFrame title="Share center" description="Everything you need to share TradeLoop in one place.">
      <ShareCenter url={buildTrackingUrl({ base: SITE_URL, code: affiliate.code, linkToken: link?.token })} coupon={coupon && coupon.type === "percent" ? { code: coupon.code, percent: Number(coupon.value) } : null} />
    </PageFrame>
  )
}
