import Link from "next/link"
import { MIN_PATTERN, conditionsParam, fmtMoney } from "@/lib/edge/core"
import type { SearchParams } from "@/lib/edge/page"
import { featureAccess } from "@/lib/features/server"
import { NOT_MEASURABLE, patterns, type Pattern } from "@/lib/psych/engine"
import { psychPage } from "@/lib/psych/page"
import { FilterBar } from "@/components/insights/client"
import { NotEnough, Pill, SampleTag, Section, linkBtn, toneClass, type PillTone } from "@/components/insights/ui"
import { RuleButton } from "@/components/psychology/panels"

const STATE: Record<Pattern["state"], { label: string; tone: PillTone }> = {
  detected: { label: "Detected", tone: "bad" },
  clear: { label: "Not detected", tone: "good" },
  unknown: { label: "Can't tell yet", tone: "none" },
}

// Behaviour patterns: each is a test run on the trade log. "Detected" means the
// numbers show it — the page says what was counted, and never why you did it.
export default async function PatternsPage({ searchParams }: { searchParams: SearchParams }) {
  const { trades, loaded } = await psychPage(searchParams)
  const canEdge = (await featureAccess()).can.edge_lab
  const list = patterns(trades)
  const order = { detected: 0, unknown: 1, clear: 2 }
  const sorted = [...list].sort((a, b) => order[a.state] - order[b.state] || (a.impact ?? 0) - (b.impact ?? 0))
  const detected = list.filter((p) => p.state === "detected")
  const cost = detected.reduce((sum, p) => sum + Math.min(0, p.impact ?? 0), 0)

  return (
    <>
      <FilterBar lookups={loaded.lookups} backtests={false} />
      {trades.length < MIN_PATTERN ? (
        <NotEnough have={trades.length} need={MIN_PATTERN}>
          Patterns are looked for once the period holds {MIN_PATTERN} closed trades. Fewer than that and one bad day would look like a habit.
        </NotEnough>
      ) : (
        <>
          <Section title={`${detected.length} of ${list.length} patterns detected`} description={detected.length ? `Together they account for ${fmtMoney(cost)} in this period. The same trade can be counted under more than one pattern.` : "None of the patterns it can test for show up in your trades in this period."}>
            <ul className="grid gap-3 lg:grid-cols-2">
              {sorted.map((p) => (
                <li key={p.key} className="flex flex-col gap-2.5 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="me-auto text-sm font-semibold">{p.title}</p>
                    <Pill tone={STATE[p.state].tone}>{STATE[p.state].label}</Pill>
                  </div>
                  <p className="text-sm text-muted-foreground">{p.summary}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">{p.basis}</span>
                    <SampleTag n={p.n} />
                    {p.metrics.map((m) => (
                      <span key={m.label} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
                        <span className="text-muted-foreground">{m.label}</span> <span className="font-medium tabular-nums">{m.value}</span>
                      </span>
                    ))}
                  </div>
                  {p.impact != null && p.state === "detected" && (
                    <p className="text-sm">
                      Result of these trades: <span className={`font-semibold tabular-nums ${toneClass(p.impact)}`}>{fmtMoney(p.impact)}</span>
                    </p>
                  )}
                  {p.state === "detected" && (
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      {p.rule && <RuleButton primary text={p.rule} source="psych_pattern" conditions={p.conditions} />}
                      {canEdge && p.conditions && (
                        <Link href={`/edge-lab?c=${encodeURIComponent(conditionsParam(p.conditions))}`} className={linkBtn}>
                          Open in Edge Lab
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="What can't be measured yet" description="Listed so you know it wasn't checked, rather than assumed fine.">
            <ul className="divide-y text-sm">
              {NOT_MEASURABLE.map((x) => (
                <li key={x.title} className="py-2">
                  <span className="font-medium">{x.title}.</span> <span className="text-muted-foreground">{x.why}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </>
  )
}
