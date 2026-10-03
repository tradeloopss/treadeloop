import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { PageHeader } from "@/components/page-header"
import { AffiliateSupportBody } from "@/components/affiliate/support-body"

export const metadata: Metadata = { title: "Support" }

export default async function AffiliateSupportPage() {
  const { affiliate } = await requireAffiliate()
  return (
    <div>
      <PageHeader title="Support" description="Answers to common questions, and a direct line to the affiliate team." />
      <AffiliateSupportBody affiliate={affiliate} />
    </div>
  )
}
