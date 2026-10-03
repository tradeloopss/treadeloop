import type { Metadata } from "next"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { notificationsFor } from "@/lib/affiliates/queries"
import { ActivityList } from "@/components/affiliate/v2/dashboard"
import { PageFrame, V2Card } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Activity" }

export default async function AffiliateV2Activity() {
  const { affiliate } = await requireAffiliate()
  const notes = await notificationsFor(affiliate.id, 100)
  return (
    <PageFrame title="Activity" description="Everything that happened on your account, newest first.">
      <V2Card>
        <ActivityList card={false} limit={100} items={notes.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, href: n.href, at: n.createdAt.toISOString() }))} />
      </V2Card>
    </PageFrame>
  )
}
