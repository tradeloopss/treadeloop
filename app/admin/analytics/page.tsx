import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { getFeatureAdoption, getFunnel, getOverview } from "@/lib/admin/metrics"
import { AdminPageHeader, BarList, Panel, StatRow, StatTile, fmtNumber, fmtPercent } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

const WINDOWS = [30, 90, 365] as const

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  await requireAdmin({ analytics: ["view"] })
  const sp = await searchParams
  const window = WINDOWS.find((w) => String(w) === sp.window) ?? 30
  const [overview, adoption, funnel] = await Promise.all([getOverview(), getFeatureAdoption(), getFunnel(window)])

  return (
    <div>
      <AdminPageHeader title="Analytics" description="Usage and onboarding, from sign-in sessions and the data users create." />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Daily active users" value={fmtNumber(overview.dau)} note="signed in within 24h" />
          <StatTile label="Weekly active users" value={fmtNumber(overview.wau)} />
          <StatTile label="Monthly active users" value={fmtNumber(overview.mau)} />
          <StatTile label="Stickiness" value={fmtPercent(overview.mau ? overview.dau / overview.mau : null)} note="DAU ÷ MAU" />
          <StatTile
            label="Trades per active trader"
            value={overview.traders7d ? (overview.trades7d / overview.traders7d).toFixed(1) : "—"}
            note="this week"
          />
        </StatRow>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Feature adoption" description={`Users who have used each feature at least once, out of ${fmtNumber(overview.users)}.`}>
            <BarList items={adoption.map((a) => ({ label: a.feature, value: a.users }))} total={overview.users} />
          </Panel>

          <Panel
            title="Onboarding funnel"
            description={`Of the users who signed up in the last ${window} days, how many reached each step.`}
            action={
              <div className="flex gap-1">
                {WINDOWS.map((w) => (
                  <Link
                    key={w}
                    href={`?window=${w}`}
                    className={cn("rounded-full border px-2.5 py-0.5 text-xs", w === window ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
                  >
                    {w}d
                  </Link>
                ))}
              </div>
            }
          >
            <BarList items={funnel.map((f) => ({ label: f.step, value: f.users }))} total={funnel[0].users} />
          </Panel>
        </div>
        <p className="text-xs text-muted-foreground">
          Active-user counts come from sign-in sessions, which refresh at most once a day, and leave out admin &quot;log in as user&quot; sessions.
        </p>
      </div>
    </div>
  )
}
