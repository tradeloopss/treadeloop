"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { getRobustness } from "@/app/actions/edge-lab"
import { conditionName, fmtExpectancy, fmtMoney, fmtPct, fmtPf, fmtR, type Conditions, type Stats } from "@/lib/edge/core"
import { monteCarlo, type MonteCarloResult, type WalkForward } from "@/lib/edge/robustness"
import { BandChart, BarRows, Columns } from "@/components/insights/charts"
import { useAction, useFilterQuery } from "@/components/insights/client"
import { Disclaimer, HELP, InfoTip, NotEnough, Pill, SampleTag, Section, fieldClass, linkBtn, linkBtnPrimary, toneClass, type PillTone } from "@/components/insights/ui"
import { ConditionBuilder, type DimOptions } from "./conditions"

type Data = { outcomes: number[]; unit: "R" | "$"; n: number; walk: WalkForward }
const SIMULATIONS = [1000, 5000, 10000, 50000]
const MIN_OUTCOMES = 20
const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)
const WALK: Record<WalkForward["verdict"], { label: string; tone: PillTone }> = {
  holds: { label: "Holds up", tone: "good" },
  weaker: { label: "Weaker out of sample", tone: "warn" },
  broke: { label: "Did not hold", tone: "bad" },
  insufficient: { label: "Insufficient data", tone: "none" },
}

function Figure({ label, value, tone, help }: { label: string; value: string; tone?: number | null; help?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {help && <InfoTip text={help} />}
      </dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", toneClass(tone))}>{value}</dd>
    </div>
  )
}

// Robustness: would this still look like an edge if the trades had come in a
// different order (Monte Carlo), and did it keep working on the trades that
// came after the ones it was found in (walk-forward)?
export function RobustnessLab({ options, initialConditions, initial }: { options: DimOptions; initialConditions: Conditions; initial: Data }) {
  const query = useFilterQuery()
  const { pending, run } = useAction()
  const [conditions, setConditions] = useState<Conditions>(initialConditions)
  const [loadedFor, setLoadedFor] = useState<Conditions>(initialConditions)
  const [data, setData] = useState<Data>(initial)
  const [simulations, setSimulations] = useState(5000)
  const [length, setLength] = useState(100)
  const [ruin, setRuin] = useState(initial.unit === "R" ? "20" : "")
  const [mc, setMc] = useState<MonteCarloResult | null>(null)
  const [running, setRunning] = useState(false)

  const fmt = (v: number) => (data.unit === "R" ? fmtR(v, 1) : fmtMoney(v))
  const dirty = JSON.stringify(conditions) !== JSON.stringify(loadedFor)
  const simulate = () => {
    setRunning(true)
    // let the button show "Running…" before the work starts
    setTimeout(() => {
      const level = Number(ruin)
      setMc(monteCarlo({ outcomes: data.outcomes, simulations, trades: Math.max(10, Math.min(1000, Math.round(length) || 100)), ruin: Number.isFinite(level) && level > 0 ? level : null, seed: 20240501 }))
      setRunning(false)
    }, 30)
  }
  const histogram = useMemo(() => {
    if (!mc) return []
    const step = Math.max(1, Math.ceil(mc.histogram.length / 16))
    const out: { label: string; n: number; negative: boolean }[] = []
    for (let i = 0; i < mc.histogram.length; i += step) {
      const group = mc.histogram.slice(i, i + step)
      const from = group[0].from
      out.push({ label: data.unit === "R" ? `${Math.round(from)}R` : `${Math.round(from)}`, n: group.reduce((s, g) => s + g.n, 0), negative: group[group.length - 1].to <= 0 })
    }
    return out
  }, [mc, data.unit])

  return (
    <>
      <Section title="What to test" description="Leave it empty to test all the trades in the period, or narrow it to one edge.">
        <ConditionBuilder options={options} value={conditions} onChange={setConditions} lead="IF" disabled={pending} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{conditionName(loadedFor)}</span>
          <SampleTag n={data.n} />
          <button
            type="button"
            disabled={pending || !dirty}
            className={cn(linkBtn, "ms-auto")}
            onClick={() =>
              run(
                () => getRobustness(conditions, query),
                (res) => {
                  setData({ outcomes: res.outcomes, unit: res.unit, n: res.n, walk: res.walk })
                  setLoadedFor(conditions)
                  setMc(null)
                  if (res.unit !== data.unit) setRuin(res.unit === "R" ? "20" : "")
                },
              )
            }
          >
            {pending ? "Loading…" : "Load these trades"}
          </button>
        </div>
      </Section>

      <Section title="Monte Carlo simulation" description="Your own results, drawn at random into thousands of possible sequences. It shows the range of runs the same edge can produce — luck included.">
        {data.outcomes.length < MIN_OUTCOMES ? (
          <NotEnough have={data.outcomes.length} need={MIN_OUTCOMES}>
            A simulation built from fewer trades would only repeat the same handful of results.
          </NotEnough>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Simulations
                <select className={cn(fieldClass, "w-32")} value={simulations} onChange={(e) => setSimulations(Number(e.target.value))}>
                  {SIMULATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.toLocaleString("en-US")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Trades per run
                <input type="number" inputMode="numeric" min={10} max={1000} className={cn(fieldClass, "w-28")} value={length} onChange={(e) => setLength(Number(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Ruin level ({data.unit === "R" ? "R lost from the start" : "$ lost from the start"})
                <input type="number" inputMode="decimal" min={0} placeholder="Optional" className={cn(fieldClass, "w-36")} value={ruin} onChange={(e) => setRuin(e.target.value)} />
              </label>
              <button type="button" disabled={running} className={cn(linkBtnPrimary, "h-9")} onClick={simulate}>
                {running ? "Running…" : mc ? "Run again" : "Run simulation"}
              </button>
            </div>
            {mc && (
              <div className="space-y-4" aria-live="polite">
                <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Figure label="Median outcome" value={fmt(mc.median)} tone={mc.median} />
                  <Figure label="Bad run (5th percentile)" value={fmt(mc.p5)} tone={mc.p5} help="One run in twenty ended at this level or worse." />
                  <Figure label="Good run (90th percentile)" value={fmt(mc.p90)} tone={mc.p90} />
                  <Figure label="Runs that lost money" value={fmtPct(mc.lossProbability)} />
                  <Figure label="Typical drawdown" value={fmt(-mc.ddMedian)} help={HELP.drawdown} />
                  <Figure label="Deep drawdown (95th)" value={fmt(-mc.dd95)} help="One run in twenty had a drawdown this deep or deeper." />
                  <Figure label="Losing streak (typical / long)" value={`${mc.streakMedian} / ${mc.streak95}`} help="The longest run of losing trades in a typical run, and in one run in twenty." />
                  <Figure label="Risk of ruin" value={mc.ruinProbability == null ? "Set a level" : fmtPct(mc.ruinProbability)} help="The share of runs that fell below the ruin level at any point." />
                </dl>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">The middle half of runs (dark), nine runs in ten (light) and the median (line).</p>
                  <BandChart bands={mc.bands} label={`Simulated runs over ${mc.trades} trades: median ${fmt(mc.median)}, 5th percentile ${fmt(mc.p5)}, 90th percentile ${fmt(mc.p90)}`} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Where the {mc.simulations.toLocaleString("en-US")} runs ended.</p>
                  <Columns signed items={histogram} label="Distribution of final results across the simulated runs" />
                </div>
                <Disclaimer kinds={["simulation", "history"]} />
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title={
          <span className="flex flex-wrap items-center gap-2">
            Walk-forward
            <Pill tone={WALK[data.walk.verdict].tone}>{WALK[data.walk.verdict].label}</Pill>
          </span>
        }
        description="The trades in order: the first 60% is where the edge was “found”, the next 20% checks it, the last 20% is the test it never saw."
      >
        <p className="text-sm">{data.walk.summary}</p>
        {data.walk.verdict !== "insufficient" && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    {["Part", "Trades", "Expectancy", "Profit factor", "Win rate", "Net"].map((h, i) => (
                      <th key={h} scope="col" className={cn("py-1.5 font-medium", i ? "ps-3 text-end" : "text-start")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.walk.segments.map((s) => (
                    <tr key={s.key}>
                      <th scope="row" className="py-1.5 text-start font-medium">
                        {s.label}
                      </th>
                      <td className="py-1.5 ps-3 text-end tabular-nums">{s.stats.n}</td>
                      <td className={cn("py-1.5 ps-3 text-end font-medium tabular-nums", toneClass(perTrade(s.stats)))}>{fmtExpectancy(s.stats)}</td>
                      <td className="py-1.5 ps-3 text-end tabular-nums">{fmtPf(s.stats)}</td>
                      <td className="py-1.5 ps-3 text-end tabular-nums">{fmtPct(s.stats.winRate, 0)}</td>
                      <td className={cn("py-1.5 ps-3 text-end tabular-nums", toneClass(s.stats.net))}>{fmtMoney(s.stats.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.walk.robustness != null && (
              <p className="text-sm text-muted-foreground">
                Robustness: <span className="font-semibold text-foreground tabular-nums">{Math.round(data.walk.robustness)}%</span> — the out-of-sample result per trade as a share of the training result.
              </p>
            )}
            {data.walk.folds.length > 1 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">The history in equal slices, oldest first</p>
                <BarRows format={(v) => (data.unit === "R" ? fmtR(v) : fmtMoney(v))} rows={data.walk.folds.map((f) => ({ label: f.label, value: perTrade(f.stats), n: f.stats.n }))} />
              </div>
            )}
          </>
        )}
      </Section>
    </>
  )
}
