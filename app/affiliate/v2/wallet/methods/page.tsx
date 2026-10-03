import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { loadPayoutPage } from "@/lib/affiliates/payout-view"
import { getV2Config } from "@/lib/affiliates/v2/server"
import { MethodManager } from "@/components/affiliate/v2/payout-methods"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Payout Methods" }

// Where payouts are sent: add, rename, choose the default, remove. Saving a
// method here never sends money — a payout is only ever asked for on the
// Payout page.
export default async function AffiliateV2PayoutMethods({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  const [data, config] = await Promise.all([loadPayoutPage(affiliate), getV2Config()])
  if (!data) return null
  const openId = Number(sp.m)

  return (
    <PageFrame title="Payout Methods" description="Add, edit, or remove where your payouts are sent." back={config.features.wallet ? { href: "/affiliate/v2/wallet", label: "Wallet" } : { href: "/affiliate/v2/payouts", label: "Payout" }} className="max-w-[1100px]">
      <MethodManager methods={data.methodViews} config={data.config} autoPayoutOn={data.autoOn} openId={Number.isInteger(openId) && openId > 0 ? openId : null} />
    </PageFrame>
  )
}
