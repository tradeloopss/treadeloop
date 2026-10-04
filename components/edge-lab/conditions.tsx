"use client"

import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DIM_BY_ID, conditionEntries, dimLabel, type Conditions, type DimId } from "@/lib/edge/core"
import { fieldClass } from "@/components/insights/ui"
import { DIM_GROUPS } from "./dims"

// What each dimension can be set to, with how many trades have that value —
// worked out from the trader's own trades, so nothing is offered that they
// have never traded.
export type DimOptions = Partial<Record<DimId, { value: string; n: number }[]>>

// A set of conditions, built one line at a time: "Session is London".
export function ConditionBuilder({ options, value, onChange, max = 5, lead = "IF", disabled }: { options: DimOptions; value: Conditions; onChange: (next: Conditions) => void; max?: number; lead?: string; disabled?: boolean }) {
  const entries = conditionEntries(value)
  const free = DIM_GROUPS.map((g) => ({ ...g, dims: g.dims.filter((d) => value[d.id] == null && (options[d.id]?.length ?? 0) > 0) })).filter((g) => g.dims.length)
  const set = (dim: DimId, v: string | null) => {
    const next = { ...value }
    if (v) next[dim] = v
    else delete next[dim]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {entries.map(([dim, v], i) => (
        <div key={dim} className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-xs font-semibold text-muted-foreground">{i === 0 ? lead : "AND"}</span>
          <span className="w-28 shrink-0 truncate text-sm font-medium sm:w-36" title={DIM_BY_ID[dim].help}>
            {dimLabel(dim)}
          </span>
          <select aria-label={`${dimLabel(dim)} is`} className={cn(fieldClass, "min-w-0 flex-1")} value={v} disabled={disabled} onChange={(e) => set(dim, e.target.value)}>
            {!options[dim]?.some((o) => o.value === v) && <option value={v}>{v}</option>}
            {options[dim]?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.n})
              </option>
            ))}
          </select>
          <button type="button" aria-label={`Remove ${dimLabel(dim)}`} disabled={disabled} onClick={() => set(dim, null)} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      ))}
      {entries.length < max && free.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-xs font-semibold text-muted-foreground">{entries.length === 0 ? lead : "AND"}</span>
          <label className="relative flex-1">
            <span className="sr-only">Add a condition</span>
            <Plus className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <select
              className={cn(fieldClass, "ps-8 text-muted-foreground")}
              value=""
              disabled={disabled}
              onChange={(e) => {
                const dim = e.target.value as DimId
                const first = options[dim]?.[0]?.value
                if (first) set(dim, first)
              }}
            >
              <option value="">{entries.length === 0 ? "Choose a condition…" : "Add another condition…"}</option>
              {free.map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.dims.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      )}
      {entries.length === 0 && free.length === 0 && <p className="text-sm text-muted-foreground">No conditions to choose from yet.</p>}
    </div>
  )
}
