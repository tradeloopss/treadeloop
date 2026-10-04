import { MIN_CELL, MIN_TRADES, fmtExpectancy, fmtMoney, fmtR, measure, select, type DimId, type Stats } from "@/lib/edge/core"
import { breakdown, excursionSummary, matrix } from "@/lib/edge/discover"
import { marketCoverage } from "@/lib/edge/market-server"
import { insightPage, type SearchParams } from "@/lib/edge/page"
import { filterKey } from "@/lib/insights/data"
import { BarRows } from "@/components/insights/charts"
import { FilterBar } from "@/components/insights/client"
import { HELP, NotEnough, Rows, Section } from "@/components/insights/ui"
import { EdgeSheetProvider } from "@/components/edge-lab/edge-sheet"
import { MatrixView } from "@/components/edge-lab/overview"
import { AnalyseButton } from "@/components/edge-lab/regimes"

// "Analyse price history" reads a slow public feed for several markets.
export const maxDuration = 60

const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)
const REGIMES: [DimId, string, string][] = [
  ["trend", "Trend", "Whether the market was trending up, trending down or ranging on the daily chart, as of the day before each trade."],
  ["volatility", "Volatility", "How large the daily ranges were against the previous 100 days."],
  ["range", "Range", "Whether the previous day's range was expanding or compressing."],
]

// Market regimes and excursions: both come from price history, which is only
// fetched when the trader asks for it.
export default async function RegimesPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId, trades, loaded, filters } = await insightPage("edge_lab", searchParams)
  const coverage = await marketCoverage(userId).catch(() => ({ measured: 0, attempted: 0 }))
  const unit = trades.some((t) => t.r != null) ? "R" : "$"
  const fmt = (v: number) => (unit === "R" ? fmtR(v) : fmtMoney(v))
  const tagged = trades.filter((t) => t.dims.trend != null).length
  const all = excursionSummary(trades)
  const overall = measure(trades)
  const bySetup = breakdown(trades, "setup", MIN_CELL)
    .map((row) => ({ value: row.value, x: excursionSummary(select(trades, { setup: row.value })), stats: row.stats }))
    .filter((r) => r.x && r.x.n >= MIN_CELL)
    .slice(0, 8)

  return (
    <EdgeSheetProvider>
      <FilterBar lookups={loaded.lookups} />

      <Section title="Price history" description="Regimes and excursions are worked out from daily and intraday prices for the markets you trade. The prices come from a free public feed (Yahoo Finance): a market it doesn't carry, or a trade older than its history, is left without a figure rather than guessed.">
        <AnalyseButton measured={coverage.measured} attempted={coverage.attempted} hasRegimes={loaded.hasRegimes} />
      </Section>

      {trades.length < MIN_TRADES ? (
        <NotEnough have={trades.length} need={MIN_TRADES}>
          Regimes are compared once the period holds {MIN_TRADES} closed trades.
        </NotEnough>
      ) : !loaded.hasRegimes || tagged === 0 ? (
        <NotEnough title="Market regimes haven't been analysed yet">Press “Analyse price history” above. Each trade is then matched with what its market was doing the day before it.</NotEnough>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {REGIMES.map(([dim, title, description]) => {
              const rows = breakdown(trades, dim, 1)
              return (
                <Section key={dim} title={title} description={description}>
                  {rows.length ? <BarRows format={fmt} rows={rows.map((r) => ({ label: r.value, value: perTrade(r.stats), n: r.stats.n }))} /> : <p className="text-sm text-muted-foreground">No trades matched with a regime.</p>}
                </Section>
              )
            })}
          </div>
          <Section title="Regime matrix" description={`${tagged.toLocaleString("en-US")} of ${trades.length.toLocaleString("en-US")} trades could be matched with a regime. Tap a cell to open it.`}>
            <MatrixView key={filterKey(filters)} initial={matrix(trades, "trend", "volatility")} />
          </Section>
        </>
      )}

      <Section title="MAE / MFE" description="How far trades went against you and in your favour before they closed, in R. Only trades with a stop can be measured.">
        {!all ? (
          <NotEnough title="No excursions measured yet">{loaded.hasExcursions ? "None of the trades in this period could be measured — they need a stop, and price history for their market." : "Press “Analyse price history” above to measure your trades."}</NotEnough>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <Rows
                rows={[
                  ["Trades measured", String(all.n)],
                  ["Average against you (MAE)", fmtR(-Math.abs(all.avgMaeR)), HELP.mae],
                  ["Median against you", fmtR(-Math.abs(all.medMaeR))],
                  ["Average in your favour (MFE)", fmtR(all.avgMfeR), HELP.mfe],
                  ["Median in your favour", fmtR(all.medMfeR)],
                  all.winnersMaeR != null && ["Winners went against you by", fmtR(-Math.abs(all.winnersMaeR))],
                  overall.expR != null && ["Average result", fmtExpectancy(overall)],
                ]}
              />
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {all.winnersMaeR != null && (
                  <li>
                    Observed: your winning trades went {fmtR(Math.abs(all.winnersMaeR)).replace("+", "")} against you on average before working. A stop tighter than that would have closed many of them.
                  </li>
                )}
                {overall.expR != null && all.avgMfeR > 0 && (
                  <li>
                    Observed: trades reached {fmtR(all.avgMfeR)} in your favour on average and closed at {fmtR(overall.expR)} — you kept about {Math.max(0, Math.round((overall.expR / all.avgMfeR) * 100))}% of the best point.
                  </li>
                )}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">By setup</p>
              {bySetup.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        {["Setup", "Measured", "Median MAE", "Median MFE", "Result"].map((h, i) => (
                          <th key={h} scope="col" className={i ? "py-1.5 ps-3 text-end font-medium" : "py-1.5 text-start font-medium"}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {bySetup.map((r) => (
                        <tr key={r.value}>
                          <th scope="row" className="max-w-40 truncate py-1.5 text-start font-medium">
                            {r.value}
                          </th>
                          <td className="py-1.5 ps-3 text-end tabular-nums">{r.x!.n}</td>
                          <td className="py-1.5 ps-3 text-end tabular-nums">{fmtR(-Math.abs(r.x!.medMaeR))}</td>
                          <td className="py-1.5 ps-3 text-end tabular-nums">{fmtR(r.x!.medMfeR)}</td>
                          <td className="py-1.5 ps-3 text-end font-medium tabular-nums">{fmtExpectancy(r.stats)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No setup has {MIN_CELL} measured trades yet.</p>
              )}
            </div>
          </div>
        )}
      </Section>
    </EdgeSheetProvider>
  )
}
