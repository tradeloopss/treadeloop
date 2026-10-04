"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { deleteHypothesisAction, promoteEdge, runComparison, runHypothesis, saveHypothesisAction, watchEdge } from "@/app/actions/edge-lab"
import { conditionName, fmtExpectancy, fmtMoney, fmtPct, fmtPf, type Conditions, type Stats } from "@/lib/edge/core"
import type { Comparison, HypothesisResult, Verdict } from "@/lib/edge/hypothesis"
import { useAction, useFilterQuery } from "@/components/insights/client"
import { HELP, Pill, SampleTag, Section, fieldClass, linkBtn, linkBtnPrimary, toneClass, type PillTone } from "@/components/insights/ui"
import { ConditionBuilder, type DimOptions } from "./conditions"

const VERDICT: Record<Verdict, { label: string; tone: PillTone }> = {
  supported: { label: "Supported", tone: "good" },
  not_supported: { label: "Not supported", tone: "bad" },
  inconclusive: { label: "Inconclusive", tone: "warn" },
}
const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)

function Compare({ a, b, labels }: { a: Stats; b: Stats; labels: [string, string] }) {
  const rows: [string, (s: Stats) => string, ((s: Stats) => number | null)?][] = [
    ["Trades", (s) => String(s.n)],
    ["Expectancy", fmtExpectancy, perTrade],
    ["Profit factor", fmtPf],
    ["Win rate", (s) => fmtPct(s.winRate)],
    ["Net result", (s) => fmtMoney(s.net), (s) => s.net],
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 text-start font-medium">
              <span className="sr-only">Measure</span>
            </th>
            {labels.map((l) => (
              <th key={l} scope="col" className="py-1.5 ps-3 text-end font-medium">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(([label, format, tone]) => (
            <tr key={label}>
              <th scope="row" className="py-1.5 text-start font-normal text-muted-foreground">
                {label}
              </th>
              {[a, b].map((s, i) => (
                <td key={i} className={cn("py-1.5 ps-3 text-end font-medium tabular-nums", tone && s.n ? toneClass(tone(s)) : "")}>
                  {s.n || label === "Trades" ? format(s) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Evidence({ title, items, Icon, cls }: { title: string; items: string[]; Icon: typeof CheckCircle2; cls: string }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="mt-1.5 space-y-1.5 text-sm">
        {items.map((e) => (
          <li key={e} className="flex gap-2">
            <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} aria-hidden />
            <span>{e}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Saved = { id: number; name: string; statement: string | null; conditions: Conditions; result: { verdict?: string; summary?: string; n?: number; expectancy?: string; baseline?: string; testedAt?: string } | null }

// A hypothesis is a set of conditions: "IF session is London AND setup is Breakout, my trades do better".
// The verdict needs a real difference, enough trades, and for the recent trades to agree.
export function HypothesisLab({ options, initial, saved }: { options: DimOptions; initial: Conditions; saved: Saved[] }) {
  const query = useFilterQuery()
  const router = useRouter()
  const { pending, run } = useAction()
  const [conditions, setConditions] = useState<Conditions>(initial)
  const [result, setResult] = useState<HypothesisResult | null>(null)
  const [name, setName] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const started = useRef(false)
  const test = (c: Conditions) => run(() => runHypothesis(c, query), (res) => setResult(res.result))

  // arriving from "Test it" on an edge: run straight away
  useEffect(() => {
    if (started.current || !Object.keys(initial).length) return
    started.current = true
    test(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const has = Object.keys(conditions).length > 0
  const v = result ? VERDICT[result.verdict] : null
  return (
    <>
      <Section title="Test a hypothesis" description="Say when you think you trade better. It is checked against every other trade in the period.">
        <ConditionBuilder
          options={options}
          value={conditions}
          disabled={pending}
          onChange={(next) => {
            setConditions(next)
            setResult(null)
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">THEN my trades do better than the rest.</span>
          <button type="button" disabled={!has || pending} className={cn(linkBtnPrimary, "ms-auto")} onClick={() => test(conditions)}>
            {pending ? "Testing…" : "Test hypothesis"}
          </button>
        </div>
      </Section>

      {result && v && (
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              {conditionName(result.conditions)}
              <Pill tone={v.tone}>{v.label}</Pill>
            </span>
          }
          description={result.summary}
        >
          <Compare a={result.condition} b={result.baseline} labels={["When true", "Every other trade"]} />
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Difference</dt>
              <dd className={cn("font-semibold tabular-nums", toneClass(result.difference))}>{result.difference == null ? "—" : `${result.difference > 0 ? "+" : "−"}${Math.abs(result.difference * 100).toFixed(0)}%`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground" title={HELP.confidence}>
                Confidence the difference is real
              </dt>
              <dd className="font-semibold tabular-nums">{result.confidence == null ? "—" : fmtPct(result.confidence, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Most recent 30%</dt>
              <dd className="flex items-center gap-1.5 font-semibold tabular-nums">
                {result.outOfSample ? (
                  <>
                    <span className={toneClass(perTrade(result.outOfSample))}>{fmtExpectancy(result.outOfSample)}</span>
                    <SampleTag n={result.outOfSample.n} />
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <div className="grid gap-4 md:grid-cols-3">
            <Evidence title="Evidence for" items={result.evidenceFor} Icon={CheckCircle2} cls="text-[var(--gain)]" />
            <Evidence title="Evidence against" items={result.evidenceAgainst} Icon={XCircle} cls="text-[var(--loss)]" />
            <Evidence title="What else could explain it" items={result.confounders} Icon={MinusCircle} cls="text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
              Name (optional)
              <input className={fieldClass} maxLength={80} placeholder={conditionName(result.conditions)} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={pending}
              className={linkBtnPrimary}
              onClick={() =>
                run(
                  () => saveHypothesisAction({ id: editing, name, conditions: result.conditions }, query),
                  () => {
                    toast.success("Hypothesis saved.")
                    setEditing(null)
                    setName("")
                    router.refresh()
                  },
                )
              }
            >
              Save hypothesis
            </button>
            <button type="button" disabled={pending || result.verdict !== "supported"} title={result.verdict !== "supported" ? "Only a supported hypothesis can become a playbook" : undefined} className={linkBtn} onClick={() => run(() => promoteEdge({ conditions: result.conditions, name: name || null }, query), () => toast.success("Added to your playbooks, and now watched in Monitor."))}>
              Add to Playbook
            </button>
            <button type="button" disabled={pending} className={linkBtn} onClick={() => run(() => watchEdge({ conditions: result.conditions, name: name || null }, query), () => toast.success("Forward test started: new trades that match are tracked in Monitor."))}>
              Forward test
            </button>
            <Link href="/backtest" className={linkBtn}>
              Run backtest
            </Link>
          </div>
        </Section>
      )}

      <Section title="Saved hypotheses" description="Each keeps the verdict from the last time it was tested. Test again as trades come in.">
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
        ) : (
          <ul className="divide-y">
            {saved.map((h) => {
              const verdict = VERDICT[(h.result?.verdict as Verdict) ?? "inconclusive"] ?? VERDICT.inconclusive
              return (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{h.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Pill tone={verdict.tone}>{verdict.label}</Pill>
                      {h.result?.n != null && <SampleTag n={h.result.n} />}
                      {h.result?.expectancy && (
                        <span>
                          {h.result.expectancy} vs {h.result.baseline ?? "—"}
                        </span>
                      )}
                      {h.result?.testedAt && <span>· tested {new Date(h.result.testedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    className={linkBtn}
                    onClick={() => {
                      setConditions(h.conditions)
                      setName(h.name)
                      setEditing(h.id)
                      test(h.conditions)
                      window.scrollTo({ top: 0 })
                    }}
                  >
                    Test again
                  </button>
                  <button type="button" disabled={pending} className={cn(linkBtn, "text-[var(--loss)]")} onClick={() => window.confirm(`Delete “${h.name}”?`) && run(() => deleteHypothesisAction(h.id), () => router.refresh())}>
                    Delete
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </>
  )
}

// A/B: two sets of conditions against each other, on the trades already taken.
export function ComparisonLab({ options }: { options: DimOptions }) {
  const query = useFilterQuery()
  const { pending, run } = useAction()
  const [a, setA] = useState<Conditions>({})
  const [b, setB] = useState<Conditions>({})
  const [result, setResult] = useState<Comparison | null>(null)
  const ready = Object.keys(a).length > 0 && Object.keys(b).length > 0
  return (
    <Section title="Compare two variations" description="Version A against version B, on the trades you have already taken. It compares what happened; it cannot replay a trade with a different stop or target.">
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["A", a, setA],
            ["B", b, setB],
          ] as const
        ).map(([label, value, set]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Version {label}</p>
            <ConditionBuilder
              options={options}
              value={value}
              max={4}
              lead="IF"
              disabled={pending}
              onChange={(next) => {
                set(next)
                setResult(null)
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" disabled={!ready || pending} className={linkBtnPrimary} onClick={() => run(() => runComparison(a, b, query), (res) => setResult(res.comparison))}>
          {pending ? "Comparing…" : "Compare"}
        </button>
      </div>
      {result && (
        <div className="space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={result.winner ? "good" : "warn"}>{result.winner ? `Version ${result.winner.toUpperCase()} is ahead` : "No clear difference"}</Pill>
            {result.confidence != null && <span className="text-xs text-muted-foreground">{fmtPct(result.confidence, 0)} confidence</span>}
            {result.overlap > 0 && <span className="text-xs text-muted-foreground">· {result.overlap} trades are in both</span>}
          </div>
          <p className="text-sm text-muted-foreground">{result.summary}</p>
          <Compare a={result.a.stats} b={result.b.stats} labels={[`A · ${conditionName(result.a.conditions)}`, `B · ${conditionName(result.b.conditions)}`]} />
        </div>
      )}
    </Section>
  )
}
