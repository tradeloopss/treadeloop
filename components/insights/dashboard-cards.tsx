import Link from "next/link"
import { ArrowRight, Brain, FlaskConical } from "lucide-react"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { analyticsCache } from "@/lib/db/schema"
import { featureAccess } from "@/lib/features/server"
import { MIN_TRADES, fmtExpectancy } from "@/lib/edge/core"
import type { Overview } from "@/lib/edge/server"
import { activeCooldown, pendingReviews } from "@/lib/psych/server"
import { PreTradeCheckin } from "@/components/psychology/checkin"
import { Pill, SampleTag, StageBadge, bandTone, linkBtn } from "./ui"

// Edge Lab and Psychology on the dashboard, for traders who have them. Nothing
// is worked out here: the Edge Lab card shows the last analysis that was saved
// when the trader opened Edge Lab, and the Psychology card counts two rows.
export async function InsightCards({ userId, timeZone }: { userId: string; timeZone: string }) {
  const access = await featureAccess()
  if (!access.can.edge_lab && !access.can.psychology) return null

  const [edge, waiting, cooldown] = await Promise.all([
    access.can.edge_lab
      ? db
          .select({ payload: analyticsCache.payload })
          .from(analyticsCache)
          .where(and(eq(analyticsCache.userId, userId), eq(analyticsCache.key, `edge:overview:all:${timeZone}`)))
          .limit(1)
          .then((rows) => (rows[0]?.payload ?? null) as Overview | null)
          .catch(() => null)
      : null,
    access.can.psychology ? pendingReviews(userId, 20).then((rows) => rows.length).catch(() => 0) : 0,
    access.can.psychology ? activeCooldown(userId).catch(() => null) : null,
  ])

  return (
    <div className="mb-4 grid gap-3 sm:mb-6 md:grid-cols-2">
      {access.can.edge_lab && (
        <section aria-label="Edge Lab" className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FlaskConical className="size-4" aria-hidden />
            Edge Lab
            <StageBadge stage={access.releases.edge_lab} />
          </div>
          {!edge ? (
            <p className="text-sm text-muted-foreground">Open Edge Lab to analyse your trades: what makes you money, what costs you, and how sure that is.</p>
          ) : !edge.enough ? (
            <p className="text-sm text-muted-foreground">
              {edge.trades} of {MIN_TRADES} closed trades logged. Edge Lab starts looking for edges at {MIN_TRADES}.
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-semibold tabular-nums">{edge.score.score == null ? "—" : Math.round(edge.score.score)}</span>
                <span className="text-sm text-muted-foreground">Edge Score</span>
                <Pill tone={bandTone(edge.score.band)}>{edge.score.band}</Pill>
              </p>
              {edge.strongest && (
                <p className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Strongest edge:</span> <span className="font-medium">{edge.strongest.name}</span>
                  <span className="tabular-nums">{fmtExpectancy(edge.strongest.stats)}</span>
                  <SampleTag n={edge.strongest.stats.n} />
                </p>
              )}
              {edge.leak && (
                <p className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Biggest leak:</span> <span className="font-medium">{edge.leak.name}</span>
                  <SampleTag n={edge.leak.stats.n} />
                </p>
              )}
            </>
          )}
          <div className="mt-auto pt-1">
            <Link href="/edge-lab" className={linkBtn}>
              Open Edge Lab <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>
      )}
      {access.can.psychology && (
        <section aria-label="Psychology" className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Brain className="size-4" aria-hidden />
            Psychology
            <StageBadge stage={access.releases.psychology} />
          </div>
          <p className="text-sm text-muted-foreground">
            {cooldown ? "You have a cool-down running. " : ""}
            {waiting > 0 ? `${waiting} ${waiting === 1 ? "trade is" : "trades are"} waiting for a 30-second review.` : "Check in before a trade to see how your state of mind changes your results."}
          </p>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <PreTradeCheckin />
            <Link href="/psychology" className={linkBtn}>
              Open Psychology <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
