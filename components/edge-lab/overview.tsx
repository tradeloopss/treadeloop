"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, ArrowDown, ArrowUp, Lightbulb, Minus, Sparkles, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { addRule, getMatrix, promoteEdge } from "@/app/actions/edge-lab"
import { MIN_CELL, MIN_PATTERN, conditionsParam, dimLabel, fmtExpectancy, fmtMoney, fmtPct, fmtPf, fmtR, type Conditions, type DimId } from "@/lib/edge/core"
import type { Candidate, Cell, Discovery, Matrix } from "@/lib/edge/discover"
import { useAction, useFilterQuery } from "@/components/insights/client"
import { HELP, InfoTip, Pill, SampleTag, ScoreRing, bandTone, fieldClass, linkBtn, linkBtnPrimary, toneClass } from "@/components/insights/ui"
import { OpenEdge, useEdgeSheet } from "./edge-sheet"

const perTrade = (c: Candidate) => (c.stats.expR != null ? c.stats.expR : c.stats.expectancy)

// The strongest edge and the costliest leak: what they are, what they rest on, what to do next.
export function EdgeCard({ candidate, kind }: { candidate: Candidate | null; kind: "edge" | "leak" }) {
  const query = useFilterQuery()
  const { pending, run } = useAction()
  const edge = kind === "edge"
  const Icon = edge ? Target : AlertTriangle
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 sm:p-5", edge ? "ring-[var(--gain)]/30" : "ring-[var(--loss)]/30")} aria-label={edge ? "Strongest edge" : "Biggest leak"}>
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className={cn("size-4", edge ? "text-[var(--gain)]" : "text-[var(--loss)]")} aria-hidden />
        {edge ? "Strongest edge" : "Biggest leak"}
      </div>
      {!candidate ? (
        <p className="text-sm text-muted-foreground">{edge ? "No combination has made money often enough yet to be called an edge. That is an honest answer, not a fault: it needs more trades, or a profitable pattern to exist." : "No combination is costing you money consistently in this period."}</p>
      ) : (
        <>
          <div>
            <p className="text-lg leading-snug font-semibold tracking-tight">{candidate.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {edge && <Pill tone={bandTone(candidate.score.band)}>{candidate.score.band}</Pill>}
              <SampleTag n={candidate.stats.n} />
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                Expectancy <InfoTip text={HELP.expectancy} />
              </dt>
              <dd className={cn("font-semibold tabular-nums", toneClass(perTrade(candidate)))}>{fmtExpectancy(candidate.stats)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                Profit factor <InfoTip text={HELP.pf} />
              </dt>
              <dd className="font-semibold tabular-nums">{fmtPf(candidate.stats)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{edge ? "Win rate" : "Cost so far"}</dt>
              <dd className={cn("font-semibold tabular-nums", !edge && toneClass(candidate.stats.net))}>{edge ? fmtPct(candidate.stats.winRate) : fmtMoney(candidate.stats.net)}</dd>
            </div>
          </dl>
          {edge && candidate.score.cap && <p className="text-xs text-muted-foreground">{candidate.score.cap}</p>}
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <OpenEdge conditions={candidate.conditions} kind={kind} className={linkBtnPrimary}>
              {edge ? "Investigate edge" : "Investigate"}
            </OpenEdge>
            {edge ? (
              <button type="button" disabled={pending || candidate.stats.n < MIN_PATTERN} className={linkBtn} onClick={() => run(() => promoteEdge({ conditions: candidate.conditions }, query), () => toast.success("Added to your playbooks, and now watched in Monitor."))}>
                Add to Playbook
              </button>
            ) : (
              <button type="button" disabled={pending} className={linkBtn} onClick={() => run(() => addRule({ text: `Avoid: ${candidate.name}`, source: "edge_leak", conditions: candidate.conditions }), () => toast.success("Rule added. It is counted against your trades from now on."))}>
                Create rule
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

const CELL: Record<Cell["state"], { cls: string; word: string }> = {
  "strong-positive": { cls: "bg-[var(--gain)]/35", word: "Strongly positive" },
  positive: { cls: "bg-[var(--gain)]/15", word: "Positive" },
  neutral: { cls: "bg-muted", word: "Flat" },
  negative: { cls: "bg-[var(--loss)]/15", word: "Negative" },
  "strong-negative": { cls: "bg-[var(--loss)]/35", word: "Strongly negative" },
  empty: { cls: "", word: "No trades" },
}
const MATRIX_DIMS: DimId[] = ["symbol", "session", "weekday", "hour", "setup", "strategy", "side", "hold", "after", "ofday", "trend", "volatility", "emotion", "plan"]

function CellMark({ cell }: { cell: Cell }) {
  if (cell.state === "empty") return <span className="text-muted-foreground/50">—</span>
  const value = cell.expR != null ? fmtR(cell.expR) : fmtMoney(cell.expectancy)
  const Arrow = cell.state.includes("positive") ? ArrowUp : cell.state.includes("negative") ? ArrowDown : Minus
  return (
    <>
      <span className="flex items-center justify-center gap-0.5 font-semibold tabular-nums">
        <Arrow className="size-3 shrink-0" aria-hidden />
        {value}
      </span>
      <span className="block text-[10px] text-muted-foreground tabular-nums">
        n={cell.n}
        {cell.thin ? " · thin" : ""}
      </span>
    </>
  )
}

// The Edge Matrix: two dimensions against each other. A cell is the average
// trade in it; colour, arrow and number all say the same thing. Cells with
// fewer than MIN_CELL trades are marked thin rather than hidden.
export function MatrixView({ initial }: { initial: Matrix }) {
  const query = useFilterQuery()
  const open = useEdgeSheet()
  const { pending, run } = useAction()
  const [m, setM] = useState(initial)
  const load = (rowDim: DimId, colDim: DimId) => run(() => getMatrix(rowDim, colDim, query), (res) => setM(res.matrix))
  const pick = (which: "row" | "col", label: string) => (
    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      {label}
      <select className={cn(fieldClass, "h-8 w-auto")} value={which === "row" ? m.rowDim : m.colDim} disabled={pending} onChange={(e) => (which === "row" ? load(e.target.value as DimId, m.colDim) : load(m.rowDim, e.target.value as DimId))}>
        {MATRIX_DIMS.filter((d) => d !== (which === "row" ? m.colDim : m.rowDim)).map((d) => (
          <option key={d} value={d}>
            {dimLabel(d)}
          </option>
        ))}
      </select>
    </label>
  )
  const cellOf = (conditions: Conditions, cell: Cell | undefined, name: string) =>
    !cell || cell.state === "empty" ? (
      <td className="border p-2 text-center text-xs">
        <CellMark cell={cell ?? { n: 0, pf: null, expR: null, expectancy: 0, winRate: 0, net: 0, state: "empty", thin: true }} />
      </td>
    ) : (
      <td className={cn("border p-0 text-center text-xs", CELL[cell.state].cls, cell.thin && "opacity-60")}>
        <button type="button" onClick={() => open(conditions, cell.net < 0 ? "leak" : "edge")} aria-label={`${name}: ${CELL[cell.state].word}, ${cell.expR != null ? fmtR(cell.expR) : fmtMoney(cell.expectancy)} per trade over ${cell.n} trades${cell.thin ? " (thin sample)" : ""}. Open details.`} className="block w-full p-2 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
          <CellMark cell={cell} />
        </button>
      </td>
    )

  return (
    <div className={cn("space-y-3", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-3">
        {pick("row", "Rows")}
        {pick("col", "Columns")}
      </div>
      {m.rows.length === 0 || m.cols.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          Nothing to show for {dimLabel(m.rowDim).toLowerCase()} against {dimLabel(m.colDim).toLowerCase()} yet. {["trend", "volatility"].includes(m.rowDim) || ["trend", "volatility"].includes(m.colDim) ? "Market regimes appear after price history is analysed in Edge Discovery → Regimes." : ["emotion", "plan"].includes(m.rowDim) || ["emotion", "plan"].includes(m.colDim) ? "It fills in as you check in before trades." : ""}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <caption className="sr-only">
              Average result per trade, {dimLabel(m.rowDim)} by {dimLabel(m.colDim)}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-card p-2 text-start text-xs font-medium text-muted-foreground">
                  {dimLabel(m.rowDim)} / {dimLabel(m.colDim)}
                </th>
                {m.cols.map((c) => (
                  <th key={c} scope="col" className="min-w-20 p-2 text-center text-xs font-medium">
                    {c}
                  </th>
                ))}
                <th scope="col" className="min-w-20 p-2 text-center text-xs font-medium text-muted-foreground">
                  All
                </th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r}>
                  <th scope="row" className="sticky left-0 z-10 max-w-36 truncate bg-card p-2 text-start text-xs font-medium" title={r}>
                    {r}
                  </th>
                  {m.cols.map((c) => (
                    <CellSlot key={c}>{cellOf({ [m.rowDim]: r, [m.colDim]: c }, m.cells[`${r}|${c}`], `${r}, ${c}`)}</CellSlot>
                  ))}
                  <CellSlot>{cellOf({ [m.rowDim]: r }, m.rowTotals[r], r)}</CellSlot>
                </tr>
              ))}
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-card p-2 text-start text-xs font-medium text-muted-foreground">
                  All
                </th>
                {m.cols.map((c) => (
                  <CellSlot key={c}>{cellOf({ [m.colDim]: c }, m.colTotals[c], c)}</CellSlot>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {(["strong-positive", "positive", "neutral", "negative", "strong-negative"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={cn("size-3 rounded-sm border", CELL[s].cls)} aria-hidden />
            {CELL[s].word}
          </span>
        ))}
        <span>
          · “thin” = fewer than {MIN_PATTERN} trades: shown, but too few to rely on. Pairings with fewer than {MIN_CELL} are left blank.
        </span>
      </div>
    </div>
  )
}
// (a fragment with a key, so a cell can be built by a plain function)
const CellSlot = ({ children }: { children: React.ReactNode }) => <>{children}</>

const KIND: Record<Discovery["kind"], { label: string; tone: "good" | "bad" | "ok" | "warn"; Icon: typeof Sparkles }> = {
  strong: { label: "Strong edge", tone: "good", Icon: Target },
  leak: { label: "Leak", tone: "bad", Icon: AlertTriangle },
  opportunity: { label: "Opportunity", tone: "ok", Icon: Lightbulb },
  consistency: { label: "Consistency", tone: "warn", Icon: Sparkles },
}
const ACTIONS: Record<Discovery["action"], string> = { investigate: "Investigate", experiment: "Create experiment", analysis: "View analysis" }

// What the engine found, each with the numbers it rests on and how strongly it can be read.
export function DiscoveryFeed({ items }: { items: Discovery[] }) {
  const query = useFilterQuery()
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing stands out from the rest in this period.</p>
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {items.map((d, i) => {
        const k = KIND[d.kind]
        return (
          <li key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={k.tone}>{k.label}</Pill>
              <span className="text-[11px] text-muted-foreground">{d.basis}</span>
              <SampleTag n={d.n} className="ms-auto" />
            </div>
            {d.title.toLowerCase() !== k.label.toLowerCase() && <p className="text-sm font-semibold">{d.title}</p>}
            <p className="text-sm text-muted-foreground">{d.text}</p>
            <div className="flex flex-wrap gap-1.5">
              {d.evidence.map((e) => (
                <span key={e.label} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
                  <span className="text-muted-foreground">{e.label}</span> <span className="font-medium tabular-nums">{e.value}</span>
                </span>
              ))}
            </div>
            <div className="mt-auto pt-1">
              {d.action === "experiment" ? (
                <Link href={`/edge-lab/hypotheses${query ? `${query}&` : "?"}c=${encodeURIComponent(conditionsParam(d.conditions))}`} className={linkBtn}>
                  {ACTIONS[d.action]}
                </Link>
              ) : (
                <OpenEdge conditions={d.conditions} kind={d.kind === "leak" ? "leak" : "edge"} className={linkBtn}>
                  {ACTIONS[d.action]}
                </OpenEdge>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// A ranked list of slices (the discovery engine's results, the setups).
export function CandidateList({ items, kind, empty }: { items: Candidate[]; kind: "edge" | "leak"; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y">
      {items.map((c) => (
        <li key={c.name}>
          <OpenEdge conditions={c.conditions} kind={kind} className="flex w-full items-center gap-3 py-2.5 text-start hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {kind === "edge" && (
              <span className="hidden sm:block">
                <ScoreRing score={c.score.score} size={44} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{c.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {kind === "edge" && <Pill tone={bandTone(c.score.band)}>{c.score.band}</Pill>}
                <SampleTag n={c.stats.n} />
                <span className="text-[11px] text-muted-foreground">
                  PF {fmtPf(c.stats)} · {fmtPct(c.stats.winRate, 0)} wins
                </span>
              </span>
            </span>
            <span className="shrink-0 text-end">
              <span className={cn("block text-sm font-semibold tabular-nums", toneClass(perTrade(c)))}>{fmtExpectancy(c.stats)}</span>
              <span className={cn("block text-[11px] tabular-nums", toneClass(c.stats.net))}>{fmtMoney(c.stats.net)}</span>
            </span>
          </OpenEdge>
        </li>
      ))}
    </ul>
  )
}

