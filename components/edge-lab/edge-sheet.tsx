"use client"

import type React from "react"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { BookOpen, Eye, FlaskConical, ShieldAlert, Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"
import { addRule, getEdgeDetail, promoteEdge, watchEdge } from "@/app/actions/edge-lab"
import { MIN_PATTERN, conditionEntries, conditionName, conditionsParam, dimLabel, fmtExpectancy, fmtMoney, fmtPct, fmtPf, fmtR, type Conditions } from "@/lib/edge/core"
import type { Detail } from "@/lib/edge/discover"
import { BarRows, Columns, LineChart } from "@/components/insights/charts"
import { Sheet, useAction, useFilterQuery } from "@/components/insights/client"
import { HELP, NotEnough, Pill, Rows, SampleTag, ScoreRing, bandTone, linkBtn, linkBtnPrimary, toneClass } from "@/components/insights/ui"

// One slice of the trader's history, opened from anywhere in Edge Lab: what it
// made, how sure that is, when it works and when it doesn't — and what to do
// with it.

type Kind = "edge" | "leak"
const Ctx = createContext<((conditions: Conditions, kind?: Kind) => void) | null>(null)

export function useEdgeSheet() {
  const open = useContext(Ctx)
  if (!open) throw new Error("EdgeSheetProvider is missing")
  return open
}

// Anything that opens a slice: a card, a heatmap cell, a row.
export function OpenEdge({ conditions, kind, className, children, label }: { conditions: Conditions; kind?: Kind; className?: string; children: React.ReactNode; label?: string }) {
  const open = useEdgeSheet()
  return (
    <button type="button" aria-label={label} onClick={() => open(conditions, kind)} className={className}>
      {children}
    </button>
  )
}

export function EdgeSheetProvider({ children, initial }: { children: React.ReactNode; initial?: Conditions | null }) {
  const query = useFilterQuery()
  const [target, setTarget] = useState<{ conditions: Conditions; kind: Kind } | null>(initial && Object.keys(initial).length ? { conditions: initial, kind: "edge" } : null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const open = useCallback((conditions: Conditions, kind: Kind = "edge") => setTarget({ conditions, kind }), [])

  useEffect(() => {
    if (!target) return
    let stale = false
    setDetail(null)
    setError(null)
    getEdgeDetail(target.conditions, query)
      .then((res) => {
        if (stale) return
        if (res.ok) setDetail(res.detail)
        else setError(res.error)
      })
      .catch(() => !stale && setError("Something went wrong. Try again."))
    return () => {
      stale = true
    }
  }, [target, query])

  return (
    <Ctx.Provider value={open}>
      {children}
      <Sheet
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? conditionName(target.conditions) : ""}
        description={target ? conditionEntries(target.conditions).map(([k, v]) => `${dimLabel(k)}: ${v}`).join(" · ") : undefined}
        footer={target && detail ? <Actions conditions={target.conditions} kind={target.kind} detail={detail} query={query} /> : undefined}
      >
        {error ? <p className="text-sm text-[var(--loss)]">{error}</p> : !detail ? <Loading /> : <Body detail={detail} />}
      </Sheet>
    </Ctx.Provider>
  )
}

const Loading = () => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
    ))}
  </div>
)

const H = ({ children }: { children: React.ReactNode }) => <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>

function Body({ detail: d }: { detail: Detail }) {
  const s = d.stats
  const perTrade = (st: Detail["stats"]) => (d.unit === "R" && st.expR != null ? st.expR : st.expectancy)
  const fmt = (v: number) => (d.unit === "R" ? fmtR(v) : fmtMoney(v))
  if (s.n === 0) return <NotEnough title="No trades match">Nothing in the selected period meets these conditions.</NotEnough>
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScoreRing score={d.score.score} band={d.score.band} />
        <div className="flex flex-col items-end gap-1.5">
          <Pill tone={bandTone(d.score.band)}>{d.score.band}</Pill>
          <SampleTag n={s.n} />
        </div>
      </div>
      {s.n < MIN_PATTERN && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Only {s.n} trades so far — too few to score. {MIN_PATTERN} are needed before this can be called anything more than an observation.
        </p>
      )}
      {d.score.cap && <p className="text-sm text-muted-foreground">{d.score.cap}</p>}

      <Rows
        rows={[
          ["Expectancy", <span key="e" className={toneClass(perTrade(s))}>{fmtExpectancy(s)}</span>, HELP.expectancy],
          ["Every other trade", fmtExpectancy(d.baseline)],
          ["Profit factor", fmtPf(s), HELP.pf],
          ["Win rate", fmtPct(s.winRate), HELP.winRate],
          ["Net result", <span key="n" className={toneClass(s.net)}>{fmtMoney(s.net)}</span>],
          ["Average win / loss", `${fmtMoney(s.avgWin)} / ${fmtMoney(s.avgLoss)}`],
          ["Largest drawdown", fmtMoney(-s.maxDd), HELP.drawdown],
          ["Confidence it is above zero", d.score.confidence == null ? "—" : fmtPct(d.score.confidence, 0), HELP.confidence],
          d.score.outOfSample && ["Most recent 30% of trades", `${fmtExpectancy(d.score.outOfSample)} · n=${d.score.outOfSample.n}`],
          s.months > 1 && ["Profitable months", `${s.posMonths} of ${s.months}`],
        ]}
      />

      <div className="space-y-2">
        <H>Running total</H>
        <LineChart values={d.curve.map((p) => p.value)} label={`Running total over ${s.n} trades, ending at ${fmt(d.curve[d.curve.length - 1]?.value ?? 0)}`} />
      </div>

      {d.score.score != null && (
        <div className="space-y-2">
          <H>Why this score</H>
          <ul className="space-y-2">
            {d.score.parts.map((p) => (
              <li key={p.key} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>{p.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{Math.round(p.value * 100)} / 100</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(p.value * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(d.best.length > 0 || d.worst.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Works best when", d.best],
            ["Works worst when", d.worst],
          ].map(([title, list]) =>
            (list as Detail["best"]).length ? (
              <div key={title as string} className="space-y-1.5">
                <H>{title as string}</H>
                <ul className="space-y-1 text-sm">
                  {(list as Detail["best"]).map((b) => (
                    <li key={`${b.dim}${b.value}`} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="text-muted-foreground">{dimLabel(b.dim)}:</span> {b.value}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className={toneClass(perTrade(b.stats))}>{fmtExpectancy(b.stats)}</span> <span className="text-[10px] text-muted-foreground">n={b.stats.n}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      )}

      {d.rDist.some((b) => b.n > 0) && (
        <div className="space-y-2">
          <H>Results in R</H>
          <Columns signed items={d.rDist.map((b) => ({ label: b.label, n: b.n, negative: /^(Below|−|-)/.test(b.label) }))} label={`Distribution of results in R: ${d.rDist.map((b) => `${b.label} ${b.n}`).join(", ")}`} />
        </div>
      )}

      {[
        ["By session", d.bySession],
        ["By day", d.byWeekday],
        ["By holding time", d.byHold],
      ].map(([title, rows]) =>
        (rows as Detail["bySession"]).length > 1 ? (
          <div key={title as string} className="space-y-2">
            <H>{title as string}</H>
            <BarRows format={fmt} rows={(rows as Detail["bySession"]).map((r) => ({ label: r.value, value: perTrade(r.stats), n: r.stats.n }))} />
          </div>
        ) : null,
      )}

      {d.psychology.map((p) => (
        <div key={p.dim} className="space-y-2">
          <H>By {dimLabel(p.dim).toLowerCase()}</H>
          <BarRows format={fmt} rows={p.rows.map((r) => ({ label: r.value, value: perTrade(r.stats), n: r.stats.n }))} />
        </div>
      ))}

      <div className="space-y-1.5">
        <H>How far trades went (MAE / MFE)</H>
        {d.excursion ? (
          <Rows
            rows={[
              ["Average against you", fmtR(-Math.abs(d.excursion.avgMaeR)), HELP.mae],
              ["Median against you", fmtR(-Math.abs(d.excursion.medMaeR))],
              ["Average in your favour", fmtR(d.excursion.avgMfeR), HELP.mfe],
              ["Median in your favour", fmtR(d.excursion.medMfeR)],
              d.excursion.winnersMaeR != null && ["Winners went against you by", fmtR(-Math.abs(d.excursion.winnersMaeR))],
              ["Trades measured", String(d.excursion.n)],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Not measured yet. Price history has to be analysed first — do it from the <span className="font-medium text-foreground">Regimes</span> tab. Trades without a stop can't be measured in R.
          </p>
        )}
      </div>

      {d.recent.length > 0 && (
        <div className="space-y-1.5">
          <H>Latest trades</H>
          <ul className="divide-y text-sm">
            {d.recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  {t.symbol} <span className="text-muted-foreground">{t.side}</span>
                </span>
                <span className="text-xs text-muted-foreground">{new Date(t.exit).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</span>
                <span className={cn("w-24 shrink-0 text-end font-medium tabular-nums", toneClass(t.pnl))}>{t.r != null ? fmtR(t.r) : fmtMoney(t.pnl)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function Actions({ conditions, kind, detail, query }: { conditions: Conditions; kind: Kind; detail: Detail; query: string }) {
  const { pending, run } = useAction()
  const name = conditionName(conditions)
  const link = (path: string) => `${path}${query ? `${query}&` : "?"}c=${encodeURIComponent(conditionsParam(conditions))}`
  const losing = detail.stats.net < 0
  if (!Object.keys(conditions).length || detail.stats.n === 0) return null
  return (
    <>
      {kind === "leak" || losing ? (
        <button
          type="button"
          disabled={pending}
          className={linkBtnPrimary}
          onClick={() => run(() => addRule({ text: `Avoid: ${name}`, source: "edge_leak", conditions }), () => toast.success("Rule added. It is counted against your trades from now on."))}
        >
          <ShieldAlert className="size-3.5" />
          Create rule
        </button>
      ) : (
        <button
          type="button"
          disabled={pending || detail.stats.n < MIN_PATTERN}
          title={detail.stats.n < MIN_PATTERN ? `Needs ${MIN_PATTERN} trades` : undefined}
          className={linkBtnPrimary}
          onClick={() => run(() => promoteEdge({ conditions }, query), () => toast.success("Added to your playbooks, and now watched in Monitor."))}
        >
          <BookOpen className="size-3.5" />
          Add to Playbook
        </button>
      )}
      <button type="button" disabled={pending} className={linkBtn} onClick={() => run(() => watchEdge({ conditions }, query), () => toast.success("Watching it. See the Monitor tab."))}>
        <Eye className="size-3.5" />
        Watch
      </button>
      <Link href={link("/edge-lab/hypotheses")} className={linkBtn}>
        <FlaskConical className="size-3.5" />
        Test it
      </Link>
      <Link href={link("/edge-lab/robustness")} className={linkBtn}>
        <Shuffle className="size-3.5" />
        Robustness
      </Link>
    </>
  )
}
