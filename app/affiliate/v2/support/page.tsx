import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { AffiliateSupportBody } from "@/components/affiliate/support-body"
import { PageFrame } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Support" }

// The same FAQ (from the live program settings) and contact form as Classic.
export default async function AffiliateV2Support() {
  const { affiliate } = await requireAffiliate()
  return (
    <PageFrame title="Support" description="Answers to common questions, and a direct line to the affiliate team.">
      <AffiliateSupportBody affiliate={affiliate} className="grid gap-4 xl:grid-cols-5" />
    </PageFrame>
  )
}
