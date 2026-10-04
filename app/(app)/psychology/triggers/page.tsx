import { MIN_PATTERN, fmtExpectancy, fmtMoney, fmtPct, type Stats } from "@/lib/edge/core"
import type { SearchParams } from "@/lib/edge/page"
import { triggers } from "@/lib/psych/engine"
import { psychPage } from "@/lib/psych/page"
import { FilterBar } from "@/components/insights/client"
import { NotEnough, SampleTag, Section, toneClass } from "@/components/insights/ui"
import { PreTradeCheckin } from "@/components/psychology/checkin"

const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)

// Triggers: the states and situations that go with a trader's worst trades.
// Most come from what the trader reported; two can be seen in the log itself.
export default async function TriggersPage({ searchParams }: { searchParams: SearchParams }) {
  const { trades, loaded } = await psychPage(searchParams)
  const list = triggers(trades)
  const seen = list.filter((t) => t.n > 0).sort((a, b) => (a.impact ?? 0) - (b.impact ?? 0))
  const unseen = list.filter((t) => t.n === 0)

  return (
    <>
      <FilterBar lookups={loaded.lookups} backtests={false} />
      {trades.length < MIN_PATTERN ? (
        <NotEnough have={trades.length} need={MIN_PATTERN}>
          Triggers are worked out once the period holds {MIN_PATTERN} closed trades.
        </NotEnough>
      ) : seen.length === 0 ? (
        <NotEnough title="No triggers recorded yet">
          Nothing in your trades or check-ins points to one. Most triggers can only be seen if you say how you feel before a trade.
        </NotEnough>
      ) : (
        <Section title="Your triggers" description="Sorted by what the trades taken in each state cost. A trade can sit under more than one.">
          <ul className="grid gap-3 lg:grid-cols-2">
            {seen.map((t) => (
              <li key={t.key} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="me-auto text-sm font-semibold">{t.label}</p>
                  <span className="text-[11px] text-muted-foreground">{t.basis}</span>
                  <SampleTag n={t.n} />
                </div>
                {t.stats ? (
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Average trade</dt>
                      <dd className={`font-semibold tabular-nums ${toneClass(perTrade(t.stats))}`}>{fmtExpectancy(t.stats)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Win rate</dt>
                      <dd className="font-semibold tabular-nums">{fmtPct(t.stats.winRate, 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Result</dt>
                      <dd className={`font-semibold tabular-nums ${toneClass(t.impact)}`}>{fmtMoney(t.impact)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">Too few trades to measure — it has happened {t.n} {t.n === 1 ? "time" : "times"}.</p>
                )}
                {t.contexts.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">It tends to come with</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {t.contexts.map((c) => (
                        <li key={c} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {trades.length >= MIN_PATTERN && unseen.length > 0 && (
        <Section title="Not recorded" description="No trade in this period was reported or seen in these states. Check in before a trade and they are tracked from then on." action={<PreTradeCheckin />}>
          <p className="text-sm text-muted-foreground">{unseen.map((t) => t.label).join(" · ")}</p>
        </Section>
      )}
    </>
  )
}
