"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saveDashboardV2Settings } from "@/app/actions/admin-affiliates"
import { V2_FEATURES, type V2Config } from "@/lib/affiliates/v2/config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// The V2 dashboard beta's controls: on/off, who gets it, the default, the
// feature switches and the monthly goal targets. The server normalises and
// stores them (lib/affiliates/v2/config) and logs the change.
export function DashboardV2Form({ initial, canManage }: { initial: V2Config; canManage: boolean }) {
  const router = useRouter()
  const [c, setC] = useState<V2Config>(initial)
  const [selected, setSelected] = useState(initial.selected.join(", "))
  const [pending, start] = useTransition()
  const set = <K extends keyof V2Config>(k: K, v: V2Config[K]) => setC((x) => ({ ...x, [k]: v }))
  const save = () =>
    start(async () => {
      const ids = selected
        .split(/[\s,;]+/)
        .map((s) => Number(s.replace(/^#/, "")))
        .filter((n) => Number.isInteger(n) && n > 0)
      const res = await saveDashboardV2Settings({ ...c, selected: ids })
      if (res.ok) {
        toast.success(res.message ?? "Saved.")
        router.refresh()
      } else toast.error(res.error)
    })
  const radio = "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
  return (
    <fieldset disabled={!canManage || pending} className="grid gap-6">
      <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <span>
          <span className="block text-sm font-medium">Affiliate Dashboard V2 (beta)</span>
          <span className="block text-xs text-muted-foreground">Off: everyone sees the Classic dashboard, and V2 addresses send people there.</span>
        </span>
        <input type="checkbox" checked={c.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-5 accent-[var(--primary)]" aria-label="V2 enabled" />
      </label>

      <div className={cn("grid gap-3", !c.enabled && "opacity-50")}>
        <p className="text-sm font-medium">Who can use it</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={radio}>
            <input type="radio" name="rollout" checked={c.rollout === "all"} onChange={() => set("rollout", "all")} className="mt-0.5" />
            <span>
              All affiliates
              <span className="block text-xs text-muted-foreground">Everyone can switch to it.</span>
            </span>
          </label>
          <label className={radio}>
            <input type="radio" name="rollout" checked={c.rollout === "selected"} onChange={() => set("rollout", "selected")} className="mt-0.5" />
            <span>
              Selected affiliates
              <span className="block text-xs text-muted-foreground">Only the affiliate IDs listed below.</span>
            </span>
          </label>
          <label className={radio}>
            <input type="radio" name="rollout" checked={c.rollout === "percent"} onChange={() => set("rollout", "percent")} className="mt-0.5" />
            <span>
              Percentage
              <span className="block text-xs text-muted-foreground">A stable share of affiliates.</span>
            </span>
          </label>
        </div>
        {c.rollout === "selected" && (
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            Affiliate IDs (from their admin page address, e.g. /admin/affiliates/42), separated by commas
            <textarea value={selected} onChange={(e) => setSelected(e.target.value)} rows={2} className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground" placeholder="12, 42, 108" />
          </label>
        )}
        {c.rollout === "percent" && (
          <label className="flex items-center gap-3 text-sm">
            <Input type="number" min={0} max={100} value={c.percent} onChange={(e) => set("percent", Number(e.target.value))} className="w-24" />% of affiliates
          </label>
        )}
        <label className="grid max-w-xs gap-1.5 text-xs text-muted-foreground">
          Default for affiliates who haven&apos;t chosen
          <select value={c.defaultVersion} onChange={(e) => set("defaultVersion", e.target.value === "v2" ? "v2" : "classic")} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground">
            <option value="classic">Classic dashboard (they can try V2)</option>
            <option value="v2">V2 beta (they can go back to Classic)</option>
          </select>
        </label>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">V2 features</p>
        {V2_FEATURES.map((f) => (
          <label key={f.key} className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <input type="checkbox" checked={c.features[f.key]} onChange={(e) => set("features", { ...c.features, [f.key]: e.target.checked })} className="mt-0.5 size-4" />
            <span>
              {f.label}
              <span className="block text-xs text-muted-foreground">{f.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Monthly goal targets</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["monthlyCustomers", "Monthly goal: paying customers"],
              ["challengeCustomers", "Challenge: new customers"],
              ["challengeClicks", "Challenge: clicks"],
              ["challengeEarnings", "Challenge: earnings ($)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="grid gap-1.5 text-xs text-muted-foreground">
              {label}
              <Input type="number" min={1} value={c.goals[k]} onChange={(e) => set("goals", { ...c.goals, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
      </div>

      {canManage && (
        <div>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save dashboard settings"}
          </Button>
        </div>
      )}
    </fieldset>
  )
}
