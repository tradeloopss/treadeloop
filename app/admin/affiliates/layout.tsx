import type React from "react"
import { inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliateFraudSignals, affiliatePayouts, affiliates } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { AffiliateSubNav } from "@/components/admin/affiliates/sub-nav"

// Everything under /admin/affiliates needs the affiliates:view permission;
// the pages that change things check affiliates:manage themselves.
export default async function AdminAffiliatesLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin({ affiliates: ["view"] })
  const one = sql<number>`count(*)::int`
  const [[apps], [payouts], [signals]] = await Promise.all([
    db.select({ v: one }).from(affiliates).where(inArray(affiliates.status, ["pending", "review"])),
    db.select({ v: one }).from(affiliatePayouts).where(inArray(affiliatePayouts.status, ["pending", "processing"])),
    db.select({ v: one }).from(affiliateFraudSignals).where(inArray(affiliateFraudSignals.status, ["open", "reviewing"])),
  ])
  return (
    <div>
      <AffiliateSubNav
        items={[
          { href: "/admin/affiliates", label: "Overview" },
          { href: "/admin/affiliates/applications", label: "Applications", badge: apps?.v || undefined },
          { href: "/admin/affiliates/payouts", label: "Payouts", badge: payouts?.v || undefined },
          { href: "/admin/affiliates/rules", label: "Commission rules" },
          { href: "/admin/affiliates/tiers", label: "Tiers" },
          { href: "/admin/affiliates/fraud", label: "Risk", badge: signals?.v || undefined },
          { href: "/admin/affiliates/resources", label: "Resources" },
          { href: "/admin/affiliates/announcements", label: "Announcements" },
        ]}
      />
      {children}
    </div>
  )
}
