import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { PageHeader } from "@/components/page-header"
import { AffiliateSettingsBody } from "@/components/affiliate/settings-body"

export const metadata: Metadata = { title: "Settings" }

export default async function AffiliateSettingsPage() {
  const ctx = await requireAffiliate()
  return (
    <div>
      <PageHeader title="Settings" description="Your affiliate profile, emails and payout details." />
      <div className="p-4 sm:p-6">
        <AffiliateSettingsBody {...ctx} />
      </div>
    </div>
  )
}
