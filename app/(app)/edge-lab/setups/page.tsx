import { MIN_CELL, MIN_PATTERN, MIN_TRADES, dimLabel, fmtExpectancy, fmtMoney, fmtPct, fmtPf, measure, scoreEdge, select, type DimId, type Stats } from "@/lib/edge/core"
import { breakdown, conditionsFor } from "@/lib/edge/discover"
import { insightPage, type SearchParams } from "@/lib/edge/page"
import { FilterBar } from "@/components/insights/client"
import { NotEnough, Pill, SampleTag, ScoreRing, Section, bandTone, linkBtn, toneClass } from "@/components/insights/ui"
import { EdgeSheetProvider, OpenEdge } from "@/components/edge-lab/edge-sheet"

const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)

// Setup DNA: for each setup (and each playbook), what it has made and the
// conditions it does best and worst in.
export default async function SetupsPage({ searchParams }: { searchParams: SearchParams }) {
  const { trades, loaded } = await insightPage("edge_lab", searchParams)
  const build = (dim: DimId) =>
    breakdown(trades, dim, MIN_CELL)
      .sort((a, b) => b.stats.n - a.stats.n)
      .slice(0, 12)
      .map((row) => {
        const slice = select(trades, { [dim]: row.value })
        const stats = measure(slice)
        return { dim, value: row.value, stats, score: scoreEdge(slice, stats), ...conditionsFor(slice, [dim, dim === "setup" ? "strategy" : "setup"]) }
      })
  const groups: [string, string, ReturnType<typeof build>][] = [
    ["Setups", "From the setup tags on your trades.", build("setup")],
    ["Strategies", "From the playbook each trade was logged under.", build("strategy")],
  ]
  const none = groups.every(([, , list]) => list.length === 0)

  return (
    <EdgeSheetProvider>
      <FilterBar lookups={loaded.lookups} />
      {trades.length < MIN_TRADES ? (
        <NotEnough have={trades.length} need={MIN_TRADES}>
          Setups are compared once the period holds {MIN_TRADES} closed trades.
        </NotEnough>
      ) : none ? (
        <NotEnough title="No setups to compare yet">
          Tag your trades with a setup, or log them under a playbook, and each one gets its own profile here. A setup needs {MIN_CELL} trades to be listed.
        </NotEnough>
      ) : (
        groups.map(([title, description, list]) =>
          list.length ? (
            <Section key={title} title={title} description={description}>
              <ul className="grid gap-3 lg:grid-cols-2">
                {list.map((s) => (
                  <li key={s.value} className="flex flex-col gap-3 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{s.value}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Pill tone={bandTone(s.score.band)}>{s.score.band}</Pill>
                          <SampleTag n={s.stats.n} />
                        </div>
                      </div>
                      <ScoreRing score={s.score.score} size={52} />
                    </div>
                    <dl className="grid grid-cols-4 gap-2 text-sm">
                      {[
                        ["Expectancy", fmtExpectancy(s.stats), perTrade(s.stats)],
                        ["Profit factor", fmtPf(s.stats), null],
                        ["Win rate", fmtPct(s.stats.winRate, 0), null],
                        ["Net", fmtMoney(s.stats.net), s.stats.net],
                      ].map(([label, value, tone]) => (
                        <div key={label as string}>
                          <dt className="text-[11px] text-muted-foreground">{label}</dt>
                          <dd className={`font-semibold tabular-nums ${toneClass(tone as number | null)}`}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.stats.n < MIN_PATTERN ? (
                      <p className="text-xs text-muted-foreground">Too few trades to say when it works best — {MIN_PATTERN} are needed.</p>
                    ) : (
                      <div className="grid gap-3 text-sm sm:grid-cols-2">
                        {(
                          [
                            ["Works best when", s.best],
                            ["Works worst when", s.worst],
                          ] as const
                        ).map(([heading, rows]) => (
                          <div key={heading}>
                            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{heading}</p>
                            {rows.length ? (
                              <ul className="mt-1 space-y-0.5">
                                {rows.slice(0, 3).map((r) => (
                                  <li key={`${r.dim}${r.value}`} className="flex items-baseline justify-between gap-2">
                                    <span className="min-w-0 truncate">
                                      <span className="text-muted-foreground">{dimLabel(r.dim)}:</span> {r.value}
                                    </span>
                                    <span className="shrink-0 text-xs tabular-nums">
                                      <span className={toneClass(perTrade(r.stats))}>{fmtExpectancy(r.stats)}</span> <span className="text-muted-foreground">n={r.stats.n}</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">Nothing stands out yet.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-auto">
                      <OpenEdge conditions={{ [s.dim]: s.value }} kind={s.stats.net < 0 ? "leak" : "edge"} className={linkBtn}>
                        Open full profile
                      </OpenEdge>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null,
        )
      )}
    </EdgeSheetProvider>
  )
}
