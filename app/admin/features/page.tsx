import type { Metadata } from "next"
import Link from "next/link"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { featureFeedback, user } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { FEATURES, STAGE_LABELS, featureLabel, isFeatureKey } from "@/lib/features/release"
import { getReleases } from "@/lib/features/server"
import { AdminPageHeader, Panel, StatePill, fmtDateTime } from "@/components/admin/ui"
import { ReleaseControl } from "@/components/admin/features/release-controls"

export const metadata: Metadata = { title: "Feature releases — TradeLoop admin" }

const RATING_LABELS: Record<string, string> = { love: "Love it", good: "Good", improve: "Needs improvement", difficult: "Difficult to use" }

// Who can see each new feature: the team only, or every user as a beta.
export default async function AdminFeaturesPage() {
  await requireAdmin({ team: ["manage"] })
  const [releases, feedback, counts] = await Promise.all([
    getReleases(),
    db
      .select({ id: featureFeedback.id, feature: featureFeedback.feature, rating: featureFeedback.rating, message: featureFeedback.message, page: featureFeedback.page, createdAt: featureFeedback.createdAt, email: user.email })
      .from(featureFeedback)
      .leftJoin(user, eq(user.id, featureFeedback.userId))
      .orderBy(desc(featureFeedback.createdAt))
      .limit(60),
    db.select({ feature: featureFeedback.feature, rating: featureFeedback.rating, n: sql<number>`count(*)::int` }).from(featureFeedback).groupBy(featureFeedback.feature, featureFeedback.rating),
  ])

  return (
    <div>
      <AdminPageHeader title="Feature releases" description="New features start with the team only. Open one to every user as a beta when it is ready — and take it back the same way." />
      <div className="space-y-6 p-4 sm:p-6">
        {FEATURES.map((f) => {
          const stage = releases[f.key]
          const ratings = counts.filter((c) => c.feature === f.key && c.rating)
          return (
            <Panel
              key={f.key}
              title={f.label}
              description={f.description}
              action={
                <Link href={f.href} className="text-sm font-medium text-primary hover:underline">
                  Open {f.label}
                </Link>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <StatePill state={stage === "beta" ? "active" : "inactive"}>{STAGE_LABELS[stage]}</StatePill>
                <span className="text-muted-foreground">{stage === "beta" ? "Visible to every signed-in user." : "Visible to admins only."}</span>
              </div>
              <ReleaseControl feature={f.key} label={f.label} stage={stage} />
              {ratings.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Beta feedback so far: {ratings.map((r) => `${RATING_LABELS[r.rating!] ?? r.rating} ${r.n}`).join(" · ")}
                </p>
              )}
            </Panel>
          )
        })}

        <Panel title="Beta feedback" description="What users sent from the “Help us improve” button, newest first.">
          <ul className="divide-y">
            {feedback.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{isFeatureKey(row.feature) ? featureLabel(row.feature) : row.feature}</span>
                  {row.rating && <span className="rounded-full border px-2 py-0.5">{RATING_LABELS[row.rating] ?? row.rating}</span>}
                  <span>{row.email ?? "Deleted user"}</span>
                  <span>· {fmtDateTime(row.createdAt)}</span>
                  {row.page && <span className="truncate">· {row.page}</span>}
                </div>
                {row.message && <p className="mt-1 text-sm whitespace-pre-wrap">{row.message}</p>}
              </li>
            ))}
            {feedback.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No feedback yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
