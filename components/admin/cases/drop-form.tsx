"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Check, AlertTriangle, Eye, Loader2, Gift } from "lucide-react"
import { cn } from "@/lib/utils"
import { validateRewards, rewardLabel, rewardTone, type RewardInput, type RewardType } from "@/lib/cases/types"
import { createDrop, updateDrop, type DropFormInput } from "@/app/actions/admin-cases"
import { TONE_ACCENT } from "@/components/cases/types"

const REWARD_TYPES: { value: RewardType; label: string }[] = [
  { value: "discount", label: "Discount" },
  { value: "free_subscription", label: "Free subscription" },
  { value: "free_month", label: "Free month" },
  { value: "custom", label: "Custom reward" },
]

const DEFAULT_REWARDS: RewardInput[] = [
  { name: "1 Month Free TradeLoop Essential", type: "free_subscription", subscriptionPlan: "essential", subscriptionMonths: 1, quantity: 2, probability: 5 },
  { name: "45% OFF", type: "discount", discountPercent: 45, quantity: 20, probability: 50 },
  { name: "55% OFF", type: "discount", discountPercent: 55, quantity: 14, probability: 35 },
  { name: "70% OFF", type: "discount", discountPercent: 70, quantity: 4, probability: 10 },
]

export type DropFormValues = {
  id?: number
  name: string
  description: string
  totalCases: number
  prizeExpirationDays: number
  startAt: string
  endAt: string
  rewards: RewardInput[]
  locked?: boolean // has claims — reward/quantity edits disabled
}

const field = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"

export function DropForm({ initial }: { initial?: DropFormValues }) {
  const router = useRouter()
  const isEdit = initial?.id != null
  const locked = initial?.locked ?? false

  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [totalCases, setTotalCases] = useState(initial?.totalCases ?? 40)
  const [prizeExpirationDays, setPrizeExpirationDays] = useState(initial?.prizeExpirationDays ?? 14)
  const [startAt, setStartAt] = useState(initial?.startAt ?? "")
  const [endAt, setEndAt] = useState(initial?.endAt ?? "")
  const [rewards, setRewards] = useState<RewardInput[]>(initial?.rewards ?? DEFAULT_REWARDS)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<null | "draft" | "active">(null)
  const [error, setError] = useState<string | null>(null)

  const problems = useMemo(() => validateRewards(totalCases, rewards), [totalCases, rewards])
  const totalSlots = rewards.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
  const totalProb = rewards.reduce((s, r) => s + (Number(r.probability) || 0), 0)
  const valid = problems.length === 0

  function patchReward(i: number, patch: Partial<RewardInput>) {
    setRewards((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function addReward() {
    setRewards((rs) => [...rs, { name: "", type: "discount", discountPercent: 10, quantity: 1, probability: 0 }])
  }
  function removeReward(i: number) {
    setRewards((rs) => rs.filter((_, j) => j !== i))
  }

  async function submit(status: "draft" | "active") {
    setError(null)
    if (status === "active" && !valid) {
      setError("Fix the configuration before publishing.")
      return
    }
    setBusy(status)
    const input: DropFormInput = { name, description, status, totalCases, prizeExpirationDays, startAt: startAt || null, endAt: endAt || null, rewards }
    const res = isEdit ? await updateDrop(initial!.id!, input) : await createDrop(input)
    setBusy(null)
    if (!res.ok) {
      setError(res.problems?.join(" ") ?? res.error)
      return
    }
    router.push("/admin/cases")
    router.refresh()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {locked && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            This drop already has claims, so the reward set and case count are locked to protect the distribution. You can still edit the name, description, dates and status.
          </div>
        )}

        {/* Drop details */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold">Drop details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Drop name</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="TradeLoop Launch Case Drop" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Description</span>
              <textarea className={cn(field, "h-20 py-2")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One case. Big rewards." />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Total cases</span>
              <input type="number" min={1} disabled={locked} className={cn(field, locked && "opacity-60")} value={totalCases} onChange={(e) => setTotalCases(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Prize expiration (days)</span>
              <input type="number" min={1} className={field} value={prizeExpirationDays} onChange={(e) => setPrizeExpirationDays(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Start date (optional)</span>
              <input type="datetime-local" className={field} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">End date (optional)</span>
              <input type="datetime-local" className={field} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </label>
          </div>
        </section>

        {/* Rewards */}
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Rewards</h2>
            {!locked && (
              <button type="button" onClick={addReward} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">
                <Plus className="size-3.5" /> Add reward
              </button>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {rewards.map((r, i) => (
              <div key={i} className="rounded-lg border bg-background p-3">
                <div className="grid gap-2 sm:grid-cols-12">
                  <input className={cn(field, "sm:col-span-5")} disabled={locked} value={r.name} onChange={(e) => patchReward(i, { name: e.target.value })} placeholder="Reward name" />
                  <select className={cn(field, "sm:col-span-3")} disabled={locked} value={r.type} onChange={(e) => patchReward(i, { type: e.target.value as RewardType })}>
                    {REWARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {r.type === "discount" ? (
                    <label className="sm:col-span-2">
                      <input type="number" min={1} max={100} className={field} disabled={locked} value={r.discountPercent ?? ""} onChange={(e) => patchReward(i, { discountPercent: Number(e.target.value) })} placeholder="% off" />
                    </label>
                  ) : r.type === "free_subscription" ? (
                    <select className={cn(field, "sm:col-span-2")} disabled={locked} value={r.subscriptionPlan ?? "essential"} onChange={(e) => patchReward(i, { subscriptionPlan: e.target.value })}>
                      <option value="essential">Essential</option>
                      <option value="pro">Pro</option>
                    </select>
                  ) : (
                    <div className="sm:col-span-2" />
                  )}
                  <div className="flex items-center gap-2 sm:col-span-2">
                    {!locked && rewards.length > 1 && (
                      <button type="button" onClick={() => removeReward(i)} aria-label="Remove reward" className="ms-auto flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Quantity
                    <input type="number" min={0} className={cn(field, "h-8")} disabled={locked} value={r.quantity} onChange={(e) => patchReward(i, { quantity: Number(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Probability %
                    <input type="number" min={0} max={100} className={cn(field, "h-8")} disabled={locked} value={r.probability} onChange={(e) => patchReward(i, { probability: Number(e.target.value) })} />
                  </label>
                  {(r.type === "free_subscription" || r.type === "free_month") && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Months
                      <input type="number" min={1} className={cn(field, "h-8")} disabled={locked} value={r.subscriptionMonths ?? 1} onChange={(e) => patchReward(i, { subscriptionMonths: Number(e.target.value) })} />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Validation summary */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <Summary label="Total cases" value={totalCases} ok />
            <Summary label="Reward slots" value={totalSlots} ok={totalSlots === totalCases} />
            <Summary label="Probability" value={`${totalProb}%`} ok={totalProb === 100} />
          </div>
          {problems.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-destructive">
              {problems.map((p, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {p}</li>)}
            </ul>
          )}
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => submit("draft")} disabled={busy != null} className="inline-flex h-11 items-center gap-2 rounded-lg border px-5 text-sm font-semibold hover:bg-accent disabled:opacity-60">
            {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : null} Save as draft
          </button>
          <button type="button" onClick={() => submit("active")} disabled={busy != null || !valid} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy === "active" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {isEdit ? "Save & publish" : "Publish drop"}
          </button>
          <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-accent lg:hidden">
            <Eye className="size-4" /> {preview ? "Hide" : "Preview"}
          </button>
        </div>
      </div>

      {/* Preview */}
      <aside className={cn("lg:block", preview ? "block" : "hidden")}>
        <div className="sticky top-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a18] p-5 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold text-white/60">
            <Eye className="size-3.5" /> Client preview
          </div>
          <div className="mt-4 text-center">
            <div className="mx-auto mb-3 flex size-24 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-violet-200">
              <Gift className="size-9" />
            </div>
            <p className="text-xl font-black">
              {name || "Untitled drop"}
            </p>
            <p className="mt-1 text-xs text-white/50">{totalCases} cases · {prizeExpirationDays}-day prizes</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {rewards.map((r, i) => {
              const tone = rewardTone(r)
              return (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                  <p className={cn("text-lg font-black", TONE_ACCENT[tone])}>{r.probability}%</p>
                  <p className="text-[10px] font-semibold text-white/40">{r.quantity} cases</p>
                  <p className="mt-1 text-xs font-bold leading-tight">{rewardLabel(r)}</p>
                </div>
              )
            })}
          </div>
        </div>
      </aside>
    </div>
  )
}

function Summary({ label, value, ok }: { label: string; value: string | number; ok: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2", ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5")}>
      <p className="text-[10px] font-medium text-muted-foreground uppercase">{label}</p>
      <p className={cn("text-sm font-bold", ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>{value}</p>
    </div>
  )
}
