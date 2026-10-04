"use client"

import { useState } from "react"
import { ChevronRight, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { discoverEdges, getDecomposition } from "@/app/actions/edge-lab"
import { MIN_PATTERN, dimLabel, fmtMoney, fmtPct, type Conditions, type DimId } from "@/lib/edge/core"
import { SEARCH_DIMS, type Candidate, type TreeNode } from "@/lib/edge/discover"
import { useAction, useFilterQuery } from "@/components/insights/client"
import { Section, fieldClass, linkBtnPrimary, toneClass } from "@/components/insights/ui"
import { ConditionBuilder, type DimOptions } from "./conditions"
import { DIM_GROUPS } from "./dims"
import { OpenEdge } from "./edge-sheet"
import { CandidateList } from "./overview"

// Results describe what happened in a trade; combining them would only find
// "the trades I graded well did well".
const NOT_SEARCHABLE: DimId[] = ["grade", "mistake", "account"]

// The discovery engine: choose what to combine, and it measures every combination.
export function DiscoverLab({ options, initial, n }: { options: DimOptions; initial: { edges: Candidate[]; leaks: Candidate[]; examined: number }; n: number }) {
  const query = useFilterQuery()
  const { pending, run } = useAction()
  const [dims, setDims] = useState<DimId[]>(SEARCH_DIMS.filter((d) => (options[d]?.length ?? 0) > 1))
  const [base, setBase] = useState<Conditions>({})
  const [depth, setDepth] = useState(3)
  const [found, setFound] = useState<{ edges: Candidate[]; leaks: Candidate[]; examined: number; n: number }>({ ...initial, n })
  const toggle = (d: DimId) => setDims((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))
  const groups = DIM_GROUPS.map((g) => ({ ...g, dims: g.dims.filter((d) => !NOT_SEARCHABLE.includes(d.id) && (options[d.id]?.length ?? 0) > 1) })).filter((g) => g.dims.length)

  return (
    <>
      <Section title="Search for combinations" description={`Every combination of what you tick is measured against your trades. A combination needs ${MIN_PATTERN} trades to be listed.`}>
        <div className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Combine</legend>
            {groups.map((g) => (
              <div key={g.group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{g.label}</span>
                {g.dims.map((d) => {
                  const on = dims.includes(d.id)
                  return (
                    <button key={d.id} type="button" aria-pressed={on} title={d.help} onClick={() => toggle(d.id)} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
                      {d.label}
                    </button>
                  )
                })}
              </div>
            ))}
            {groups.length === 0 && <p className="text-sm text-muted-foreground">Your trades don't vary enough yet to combine anything.</p>}
          </fieldset>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Only within (optional)</p>
            <ConditionBuilder options={options} value={base} onChange={setBase} max={3} lead="IN" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Conditions per combination
              <select className={cn(fieldClass, "w-40")} value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                {[1, 2, 3, 4].map((d) => (
                  <option key={d} value={d}>
                    Up to {d}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={pending || dims.length === 0} className={cn(linkBtnPrimary, "h-9")} onClick={() => run(() => discoverEdges({ dims, conditions: base, depth }, query), (res) => setFound(res))}>
              <Search className="size-3.5" />
              {pending ? "Searching…" : "Search"}
            </button>
            <p className="text-xs text-muted-foreground">
              {found.examined.toLocaleString("en-US")} combinations measured across {found.n.toLocaleString("en-US")} trades.
            </p>
          </div>
        </div>
      </Section>

      <div className={cn("grid gap-4 lg:grid-cols-2", pending && "opacity-60")} aria-busy={pending}>
        <Section title="Edges" description="Ranked by score: sample size and consistency count as much as the result.">
          <CandidateList items={found.edges} kind="edge" empty="No combination made money over enough trades. Widen the date range or combine fewer things." />
        </Section>
        <Section title="Leaks" description="Ranked by what they have cost you.">
          <CandidateList items={found.leaks} kind="leak" empty="No combination lost money over enough trades." />
        </Section>
      </div>
    </>
  )
}

const ORDER_DIMS: DimId[] = ["symbol", "session", "side", "weekday", "setup", "strategy", "hold", "after", "trend", "emotion"]

function Node({ node, total, depth }: { node: TreeNode; total: number; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  const share = total ? Math.abs(node.net) / total : 0
  return (
    <li>
      <div className="flex items-center gap-1.5 py-1" style={{ paddingInlineStart: depth * 16 }}>
        {node.children.length ? (
          <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`} onClick={() => setOpen(!open)} className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted">
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <OpenEdge conditions={node.conditions} kind={node.net < 0 ? "leak" : "edge"} className="min-w-0 flex-1 truncate text-start text-sm hover:underline">
          {node.dim && <span className="text-muted-foreground">{dimLabel(node.dim)}: </span>}
          {node.label}
        </OpenEdge>
        <span className="hidden h-2 w-24 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
          <span className={cn("block h-full rounded-full", node.net >= 0 ? "bg-[var(--gain)]/70" : "bg-[var(--loss)]/70")} style={{ width: `${Math.min(100, share * 100)}%` }} />
        </span>
        <span className={cn("w-20 shrink-0 text-end text-sm font-medium tabular-nums", toneClass(node.net))}>{fmtMoney(node.net)}</span>
        <span className="w-24 shrink-0 text-end text-[11px] text-muted-foreground tabular-nums">
          n={node.n} · {fmtPct(node.winRate, 0)}
        </span>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.label} node={c} total={total} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

// Where the result comes from: the total split by one thing, then the next.
export function Decomposition({ initial, total, n, options }: { initial: TreeNode[]; total: number; n: number; options: DimOptions }) {
  const query = useFilterQuery()
  const { pending, run } = useAction()
  const usable = ORDER_DIMS.filter((d) => (options[d]?.length ?? 0) > 1)
  const [order, setOrder] = useState<DimId[]>(["symbol", "session", "side"])
  const [tree, setTree] = useState(initial)
  const change = (i: number, dim: DimId) => {
    const next = order.map((d, k) => (k === i ? dim : d)).filter((d, k, list) => list.indexOf(d) === k)
    setOrder(next)
    run(() => getDecomposition(next, query), (res) => setTree(res.tree))
  }
  const gross = tree.reduce((s, t) => s + Math.abs(t.net), 0)
  return (
    <Section title="Where your result comes from" description={`${fmtMoney(total)} over ${n.toLocaleString("en-US")} trades, split step by step. Open a branch to see what is inside it.`}>
      <div className="flex flex-wrap items-center gap-2">
        {order.map((d, i) => (
          <label key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {i === 0 ? "Split by" : "then"}
            <select className={cn(fieldClass, "h-8 w-auto")} value={d} disabled={pending} onChange={(e) => change(i, e.target.value as DimId)}>
              {usable.filter((u) => u === d || !order.includes(u)).map((u) => (
                <option key={u} value={u}>
                  {dimLabel(u)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {tree.length ? (
        <ul className={cn("divide-y", pending && "opacity-60")} aria-busy={pending}>
          {tree.map((node) => (
            <Node key={node.label} node={node} total={gross} depth={0} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing to split yet.</p>
      )}
    </Section>
  )
}
