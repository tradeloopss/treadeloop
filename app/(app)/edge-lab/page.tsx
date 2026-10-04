import { headers } from "next/headers"
import { requireFeature } from "@/lib/features/server"
import { parseFilters } from "@/lib/insights/data"
import { resolveTimeZone } from "@/lib/timezone"
import { MIN_TRADES, fmtExpectancy, fmtPct, fmtPf, parseConditionsParam, type Conditions, type Stats } from "@/lib/edge/core"
import { monitors, overview } from "@/lib/edge/server"
import { FilterBar } from "@/components/insights/client"
import { HELP, Metric, NotEnough, ScoreRing, Section, type Delta } from "@/components/insights/ui"
import { EdgeSheetProvider } from "@/components/edge-lab/edge-sheet"
import { DiscoveryFeed, EdgeCard, MatrixView } from "@/components/edge-lab/overview"

type Search = Promise<Record<string, string | string[] | undefined>>

const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)
function change(now: number | null, before: number | null, format: (v: number) => string): Delta {
  if (now == null || before == null) return null
  const diff = now - before
  if (Math.abs(diff) < 1e-9) return { text: "No change", direction: "flat", good: null }
  return { text: `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`, direction: diff > 0 ? "up" : "down", good: diff > 0 }
}

export default async function EdgeLabPage({ searchParams }: { searchParams: Search }) {
  const { userId } = await requireFeature("edge_lab")
  const sp = await searchParams
  const filters = parseFilters(sp)
  const { data, loaded } = await overview(userId, filters, resolveTimeZone(await headers()))
  const { stats, score, previous } = data
  // Watched edges are checked whenever Edge Lab is opened: this is what raises
  // an alert when one has weakened. It reads the trades already loaded.
  await monitors(userId, loaded.all).catch(() => [])

  // A link from a trade ("see the edge this trade belongs to") opens that slice.
  let initial: Conditions | null = null
  const like = Number(Array.isArray(sp.like) ? sp.like[0] : sp.like)
  if (Number.isInteger(like) && like > 0) {
    const trade = loaded.all.find((t) => t.id === like || t.copies.includes(like))
    if (trade) initial = Object.fromEntries((["symbol", "side", "session", "setup"] as const).flatMap((d) => (trade.dims[d] ? [[d, trade.dims[d]!]] : [])))
  } else {
    const c = parseConditionsParam(Array.isArray(sp.c) ? sp.c[0] : sp.c)
    if (Object.keys(c).length) initial = c
  }

  return (
    <EdgeSheetProvider initial={initial}>
      <FilterBar lookups={loaded.lookups} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 flex flex-col justify-between gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">Edge Score</p>
          <ScoreRing score={score.score} band={score.band} />
          <p className="text-xs text-muted-foreground">{score.score == null ? `Needs ${MIN_TRADES} closed trades.` : (score.cap ?? "Out of 100: sample size, expectancy, consistency and how recent trades did.")}</p>
          {previous?.score != null && score.score != null && (
            <p className="text-xs text-muted-foreground">
              {score.score - previous.score > 0 ? "+" : score.score - previous.score < 0 ? "−" : ""}
              {Math.abs(Math.round(score.score - previous.score))} vs previous period
            </p>
          )}
        </div>
        <Metric label="Expectancy" help={HELP.expectancy} value={fmtExpectancy(stats)} tone={stats.n ? perTrade(stats) : null} sub="per trade" delta={previous ? change(perTrade(stats), perTrade(previous.stats), (v) => (stats.expR != null ? `${v.toFixed(2)}R` : `$${v.toFixed(0)}`)) : null} />
        <Metric label="Profit factor" help={HELP.pf} value={fmtPf(stats)} sub={`${fmtPct(stats.winRate, 0)} win rate`} delta={previous ? change(stats.pf, previous.stats.pf, (v) => v.toFixed(2)) : null} />
        <Metric label="Edge confidence" help={HELP.confidence} value={score.confidence == null ? "—" : fmtPct(score.confidence, 0)} sub={score.confidence == null ? "Not enough trades" : "that the average trade is above zero"} />
        <Metric label="Sample size" help={HELP.sample} value={stats.n.toLocaleString("en-US")} sub={stats.n < MIN_TRADES ? `${MIN_TRADES - stats.n} more to analyse` : "closed trades"} delta={previous ? change(stats.n, previous.stats.n, (v) => String(Math.round(v))) : null} />
      </div>

      {!data.enough ? (
        <NotEnough have={stats.n} need={MIN_TRADES}>
          Edge Lab starts looking for edges once this period holds {MIN_TRADES} closed trades. With fewer, anything it found would be chance. Try a longer date range, or keep logging.
        </NotEnough>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <EdgeCard candidate={data.strongest} kind="edge" />
            <EdgeCard candidate={data.leak} kind="leak" />
          </div>

          <Section title="Edge Matrix" description="The average trade for every pairing. Tap a cell to open it.">
            <MatrixView key={filtersKey(sp)} initial={data.matrix} />
          </Section>

          <Section title="Discoveries" description={`From ${data.examined.toLocaleString("en-US")} combinations of your own trades. Each shows the numbers it rests on.`}>
            <DiscoveryFeed items={data.discoveries} />
          </Section>
        </>
      )}
    </EdgeSheetProvider>
  )
}

// The matrix keeps the dimensions the trader picked — until the filters change.
const filtersKey = (sp: Record<string, string | string[] | undefined>) => JSON.stringify(sp)
