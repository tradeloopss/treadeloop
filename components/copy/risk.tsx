"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowDown, Crown, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { saveCopyFollowers } from "@/app/actions/copy-trading"
import { formatQuantity, listedContracts, relatedSymbol, specFor, unitLabel } from "@/lib/copy/contracts"
import { DEFAULT_FOLLOWER, MULTIPLIER_PRESETS, NO_PROPSYNC, ROUNDING_RULES, SIZING_MODES, calculateFollowerOrder, calculateRisk, riskStatus, roundingLabel, sizingLabel, type Decision, type FollowerConfig, type LeaderOrder, type RoundingRule, type SizingMode } from "@/lib/copy/engine"
import { money, type AccountView, type FollowerView, type GroupView } from "@/lib/copy/view"
import { Sheet, useAction } from "@/components/insights/client"
import { NotEnough, Pill, Section, fieldClass, linkBtn, linkBtnPrimary, type PillTone } from "@/components/insights/ui"
import { ChangeLeaderDialog } from "./dialogs"
import { useCopy } from "./store"
import { GroupSelect, HealthPill, PageHead, Stat, Toggle, isOnline } from "./ui"

// Risk Management answers one question: if my Leader opens 1 contract, what
// will each account open? Every quantity on this page comes from the same
// function the engine uses to send orders (calculateFollowerOrder), so the
// preview is the truth, and it changes as the trader types.

type Draft = { accountId: number; config: FollowerConfig; mappings: { leaderSymbol: string; followerSymbol: string }[] }
const toDraft = (f: FollowerView): Draft => ({ accountId: f.accountId, config: { ...f.config }, mappings: f.mappings.map((m) => ({ ...m })) })
const numOrNull = (v: string) => (v.trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const STATUS: Record<"healthy" | "limited" | "blocked", { label: string; tone: PillTone }> = { healthy: { label: "Healthy", tone: "good" }, limited: { label: "Limited", tone: "warn" }, blocked: { label: "Blocked", tone: "bad" } }
const PRESETS: { key: string; label: string; percentage: number; hint: string }[] = [
  { key: "conservative", label: "Conservative", percentage: 50, hint: "50% of Leader" },
  { key: "balanced", label: "Balanced", percentage: 100, hint: "100% of Leader" },
  { key: "aggressive", label: "Aggressive", percentage: 200, hint: "200% of Leader" },
]

function Num({ label, value, onChange, suffix, placeholder, step = "any", className }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string; placeholder?: string; step?: string; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground", className)}>
      {label}
      <span className="relative">
        <input type="number" inputMode="decimal" step={step} min={0} className={cn(fieldClass, suffix && "pe-8")} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(numOrNull(e.target.value))} />
        {suffix && <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  )
}

// The one value a copy mode needs, beside the mode itself.
function ModeValue({ config, set }: { config: FollowerConfig; set: (patch: Partial<FollowerConfig>) => void }) {
  switch (config.sizingMode) {
    case "percentage":
      return <Num label="Percentage of Leader" value={config.percentage} suffix="%" onChange={(v) => set({ percentage: v })} />
    case "multiplier":
      return (
        <div className="flex flex-col gap-1.5">
          <Num label="Multiplier" value={config.multiplier} suffix="x" onChange={(v) => set({ multiplier: v })} />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Multiplier presets">
            {MULTIPLIER_PRESETS.map((m) => (
              <button key={m} type="button" aria-pressed={config.multiplier === m} onClick={() => set({ multiplier: m })} className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", config.multiplier === m ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
                {m}x
              </button>
            ))}
          </div>
        </div>
      )
    case "risk":
      return <Num label="Risk per trade (of this account's equity)" value={config.riskPercentage} suffix="%" onChange={(v) => set({ riskPercentage: v })} />
    case "fixed":
      return <Num label="Fixed quantity" value={config.fixedQuantity} onChange={(v) => set({ fixedQuantity: v })} />
    case "custom":
      return <Num label="Share of the account-size ratio" value={config.customFactor} suffix="%" onChange={(v) => set({ customFactor: v })} />
    default:
      return <p className="self-end pb-2 text-xs text-muted-foreground">The same quantity as the Leader (100%, 1x).</p>
  }
}

const ratioText = (c: FollowerConfig) => (c.sizingMode === "same" ? "100%" : c.sizingMode === "percentage" ? `${formatQuantity(c.percentage ?? 100)}%` : c.sizingMode === "multiplier" ? `${formatQuantity(c.multiplier ?? 1)}x` : c.sizingMode === "risk" ? `Risk ${formatQuantity(c.riskPercentage ?? 1)}%` : c.sizingMode === "fixed" ? `Fixed ${formatQuantity(c.fixedQuantity ?? 1)}` : "By account size")

// The quantity a follower ends up with, or why it gets none.
function Outcome({ d, side, big }: { d: Decision; side: LeaderOrder["side"]; big?: boolean }) {
  const spec = specFor(d.symbol)
  if (!d.allowed) return <span className={cn("font-semibold text-[var(--loss)]", big ? "text-base" : "text-sm")}>Not copied</span>
  return (
    <span className={cn("font-semibold tabular-nums", big ? "text-base" : "text-sm")}>
      {side === "long" ? "BUY" : "SELL"} {formatQuantity(d.finalQuantity)} {d.symbol}
      <span className="sr-only"> {unitLabel(spec, d.finalQuantity)}</span>
    </span>
  )
}

function Why({ d }: { d: Decision }) {
  return (
    <ol className="space-y-2">
      {d.steps.map((s) => (
        <li key={s.key} className="flex gap-2.5 text-sm">
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", s.state === "blocked" ? "bg-[var(--loss)]" : s.state === "adjusted" ? "bg-[var(--warning)]" : "bg-[var(--gain)]")} aria-hidden />
          <span className="min-w-0">
            <span className="text-muted-foreground">{s.label}: </span>
            <span className="font-medium">{s.value}</span>
            {s.note && <span className="block text-xs text-muted-foreground">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function RiskManagement() {
  const { state, group, account, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [drafts, setDrafts] = useState<Draft[]>(() => (group ? group.followers.map(toDraft) : []))
  const [limits, setLimits] = useState(group?.limits ?? { defaultMode: "same", defaultRatio: 1, globalRiskPct: 1, respectPropSync: true })
  const [editing, setEditing] = useState<number | null>(null)
  const [why, setWhy] = useState<number | null>(null)
  const [leaderDialog, setLeaderDialog] = useState(false)
  // the example the preview is worked out for
  const firstSymbol = group?.contracts[0]?.symbol ?? listedContracts("NQ")[0].symbol
  const [order, setOrder] = useState<LeaderOrder>({ symbol: firstSymbol, side: "long", quantity: 1, orderType: "market", entry: null, stopLoss: null, takeProfit: null })
  const [calcAccount, setCalcAccount] = useState<number | null>(null)
  const [calcRisk, setCalcRisk] = useState<number | null>(1)

  // another group was picked, or this one was saved: start again from what is stored
  const stored = useMemo(() => JSON.stringify(group ? [group.followers.map(toDraft), group.limits] : null), [group])
  useEffect(() => {
    if (!group) return
    setDrafts(group.followers.map(toDraft))
    setLimits(group.limits)
    setOrder((o) => (group.contracts.length && !group.contracts.some((c) => c.symbol === o.symbol) ? { ...o, symbol: group.contracts[0].symbol } : o))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, stored])

  const leader = group ? account(group.leaderAccountId) : undefined
  const decide = (d: Draft, config: FollowerConfig = d.config): Decision => {
    const a = account(d.accountId)
    const symbol = d.mappings.find((m) => m.leaderSymbol === order.symbol.toUpperCase())?.followerSymbol ?? order.symbol
    const spec = group?.contracts.find((c) => c.symbol === symbol.toUpperCase()) ?? specFor(symbol)
    return calculateFollowerOrder({ order, spec, config, leaderEquity: leader?.equity ?? leader?.balance ?? null, account: { equity: a?.equity ?? a?.balance ?? null, dayPnl: a?.dayPnl ?? 0, openNotional: a?.openNotional ?? 0, openQuantity: 0, connected: isOnline(a) }, propSync: limits.respectPropSync ? (a?.propSync ?? NO_PROPSYNC) : NO_PROPSYNC, rules: null })
  }
  const decisions = useMemo(() => new Map(drafts.map((d) => [d.accountId, decide(d)])), [drafts, order, limits.respectPropSync, state.accounts, group?.contracts]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!group)
    return (
      <NotEnough title="Create your first Copy Group.">
        Risk Management sets how much each Follower copies from a group&apos;s Leader. <Link href="/copy-trading" className="font-medium text-primary hover:underline">Create a group on the Copy Dashboard</Link> to begin.
      </NotEnough>
    )

  const dirty = JSON.stringify([drafts, limits]) !== stored
  const patch = (accountId: number, p: Partial<FollowerConfig>) => setDrafts((list) => list.map((d) => (d.accountId === accountId ? { ...d, config: { ...d.config, ...p } } : d)))
  const free = state.accounts.filter((a) => a.id !== group.leaderAccountId && !drafts.some((d) => d.accountId === a.id))
  const spec = group.contracts.find((c) => c.symbol === order.symbol.toUpperCase()) ?? specFor(order.symbol)
  const unit = unitLabel(spec, order.quantity)
  const current = editing != null ? drafts.find((d) => d.accountId === editing) : undefined
  const save = () =>
    run(
      () => saveCopyFollowers(group.id, drafts, limits),
      async () => {
        toast.success("Risk settings saved.")
        await refresh()
        router.refresh()
      },
    )
  const symbols = [...new Set([...group.contracts.map((c) => c.symbol), order.symbol.toUpperCase()])]
  const leaderRisk = calculateRisk({ entry: order.entry, stopLoss: order.stopLoss, spec })
  const calcDraft = drafts.find((d) => d.accountId === (calcAccount ?? drafts[0]?.accountId))
  const calc = calcDraft ? decide(calcDraft, { ...calcDraft.config, sizingMode: "risk", riskPercentage: calcRisk }) : null

  return (
    <>
      <PageHead title="Risk Management" subtitle="Control how much each account copies from your Leader.">
        <GroupSelect />
        <Pill tone={group.status === "active" ? "good" : "none"}>{group.status === "active" ? "Risk system active" : "Group not copying"}</Pill>
        <button type="button" disabled={!dirty || pending} className={linkBtnPrimary} onClick={save}>
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leader balance" value={money(leader?.balance)} sub={leader?.name ?? "No Leader"} />
        <Stat label="Followers" value={drafts.length} sub={`${drafts.filter((d) => d.config.enabled).length} switched on`} />
        <Stat label="Default copy ratio" value={`${formatQuantity(limits.defaultRatio)}x`} sub="For followers you add" />
        <Stat label="Global risk" value={`${formatQuantity(limits.globalRiskPct)}%`} sub="Default for Risk % mode" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <Section title="Leader account" description="The reference account: followers copy what it trades.">
          {leader ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <Crown className="size-4 text-amber-500" aria-hidden />
                <span className="min-w-0 truncate">{leader.name}</span>
              </p>
              <p className="text-muted-foreground">{leader.platform}</p>
              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Balance</dt>
                  <dd className="font-semibold tabular-nums">{money(leader.balance)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Equity</dt>
                  <dd className="font-semibold tabular-nums">{money(leader.equity)}</dd>
                </div>
              </dl>
              <HealthPill health={leader.health} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">The Leader account no longer exists. Choose another.</p>
          )}
          <button type="button" className={linkBtn} onClick={() => setLeaderDialog(true)}>
            Change Leader
          </button>
          <label className="flex items-start gap-2.5 border-t pt-3 text-sm">
            <Toggle checked={limits.respectPropSync} onChange={(v) => setLimits({ ...limits, respectPropSync: v })} label="Apply PropSync rules" />
            <span>
              <span className="flex items-center gap-1 font-medium">
                <ShieldCheck className="size-3.5" aria-hidden /> Apply PropSync rules
              </span>
              <span className="block text-xs text-muted-foreground">A copy that would break a follower&apos;s prop-firm rules is not sent.</span>
            </span>
          </label>
        </Section>

        <Section title="What happens when the Leader trades?" description="Change the example and every account's size updates at once.">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Symbol
              <select className={fieldClass} value={order.symbol.toUpperCase()} onChange={(e) => setOrder({ ...order, symbol: e.target.value })}>
                {symbols.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Direction
              <select className={fieldClass} value={order.side} onChange={(e) => setOrder({ ...order, side: e.target.value as LeaderOrder["side"] })}>
                <option value="long">Buy</option>
                <option value="short">Sell</option>
              </select>
            </label>
            <Num label={`Leader quantity`} value={order.quantity} step={String(spec.quantityStep)} onChange={(v) => setOrder({ ...order, quantity: v && v > 0 ? v : 0 })} />
            <Num label="Entry price" value={order.entry} placeholder="Optional" onChange={(v) => setOrder({ ...order, entry: v })} />
            <Num label="Stop loss" value={order.stopLoss} placeholder="Optional" onChange={(v) => setOrder({ ...order, stopLoss: v })} />
          </div>

          {/* the signature diagram: the Leader's order, and what each account does with it */}
          <div className="rounded-xl border bg-muted/30 p-3 sm:p-4" role="img" aria-label={`Leader ${order.side === "long" ? "buys" : "sells"} ${formatQuantity(order.quantity)} ${order.symbol}. ${drafts.map((d) => `${account(d.accountId)?.name ?? "Account"}: ${decisions.get(d.accountId)?.allowed ? `${formatQuantity(decisions.get(d.accountId)!.finalQuantity)} ${decisions.get(d.accountId)!.symbol}` : "not copied"}`).join(". ")}`}>
            <div className="mx-auto w-fit rounded-xl bg-[linear-gradient(135deg,var(--primary),#3b82f6)] px-5 py-2.5 text-center text-white shadow-[0_10px_24px_-12px_var(--primary)]">
              <p className="flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase opacity-90">
                <Crown className="size-3" aria-hidden /> Leader
              </p>
              <p className="text-base font-semibold tabular-nums">
                {order.side === "long" ? "BUY" : "SELL"} {formatQuantity(order.quantity)} {order.symbol.toUpperCase()}
              </p>
            </div>
            {drafts.length === 0 ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">Add a follower below to see what it would open.</p>
            ) : (
              <>
                <div className="mx-auto h-5 w-px bg-border" aria-hidden />
                <div className="hidden h-px bg-border sm:block" style={{ marginInline: `${50 / Math.min(drafts.length, 4)}%` }} aria-hidden />
                <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {drafts.map((d) => {
                    const a = account(d.accountId)
                    const dec = decisions.get(d.accountId)!
                    return (
                      <li key={d.accountId} className="flex flex-col items-center">
                        <ArrowDown className="size-4 text-muted-foreground sm:hidden" aria-hidden />
                        <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
                        <button type="button" onClick={() => setWhy(d.accountId)} className={cn("w-full rounded-xl border bg-card p-2.5 text-center transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", !dec.allowed && "border-[var(--loss)]/40")}>
                          <span className="block truncate text-xs font-semibold">{a?.name ?? "Account"}</span>
                          <span className="block text-[11px] text-muted-foreground">{ratioText(d.config)}</span>
                          <Outcome d={dec} side={order.side} big />
                          <span className="mt-0.5 block text-[11px] text-primary">Why?</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
          {drafts.some((d) => d.config.sizingMode === "risk") && (order.entry == null || order.stopLoss == null) && <p className="text-xs text-muted-foreground">Enter an entry price and a stop loss to see what the Risk % accounts would open: their size depends on the distance to the stop.</p>}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Presets</span>
            {PRESETS.map((p) => (
              <button key={p.key} type="button" disabled={!drafts.length} className={linkBtn} onClick={() => setDrafts((list) => list.map((d) => ({ ...d, config: { ...d.config, sizingMode: "percentage", percentage: p.percentage } })))}>
                {p.label} <span className="text-xs text-muted-foreground">{p.hint}</span>
              </button>
            ))}
            <span className="text-xs text-muted-foreground">or set each account below (Custom).</span>
          </div>
        </Section>
      </div>

      <Section
        title="Follower risk & position sizing"
        description={`If the Leader opens ${formatQuantity(order.quantity)} ${unit} of ${order.symbol.toUpperCase()}, this is what each account opens.`}
        action={
          free.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="sr-only">Add a follower</span>
              <Plus className="size-4 text-muted-foreground" aria-hidden />
              <select
                className={cn(fieldClass, "h-8 w-auto")}
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value)
                  if (id) setDrafts((list) => [...list, { accountId: id, mappings: [], config: { ...DEFAULT_FOLLOWER, sizingMode: (limits.defaultMode as SizingMode) || "same", multiplier: limits.defaultRatio, percentage: limits.defaultRatio * 100, riskPercentage: limits.globalRiskPct } }])
                }}
              >
                <option value="">Add a follower…</option>
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.platform}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        {drafts.length === 0 ? (
          <NotEnough title="No followers yet">Add an account above. It will copy the Leader within the limits you set here.</NotEnough>
        ) : (
          <>
            {/* a table where there is room for one, cards on a phone */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    {["Follower", "Balance", "Mode", "Leader size", "Risk %", "Multiplier", "Follower size", "Max size", "Rounding", "Status", ""].map((h, i) => (
                      <th key={i} scope="col" className={cn("py-2 font-medium", i === 0 ? "text-start" : "ps-3 text-start")}>
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {drafts.map((d) => {
                    const a = account(d.accountId)
                    const dec = decisions.get(d.accountId)!
                    const st = riskStatus(d.config, { equity: a?.equity ?? null, dayPnl: a?.dayPnl ?? 0, openNotional: 0, openQuantity: 0, connected: isOnline(a) }, limits.respectPropSync ? a?.propSync : undefined)
                    return (
                      <tr key={d.accountId}>
                        <th scope="row" className="max-w-44 truncate py-2.5 text-start font-medium">
                          {a?.name ?? "Deleted account"}
                        </th>
                        <td className="py-2.5 ps-3 tabular-nums">{money(a?.balance)}</td>
                        <td className="py-2.5 ps-3">
                          <select aria-label={`Copy mode for ${a?.name}`} className={cn(fieldClass, "h-8 w-36")} value={d.config.sizingMode} onChange={(e) => patch(d.accountId, { sizingMode: e.target.value as SizingMode })}>
                            {SIZING_MODES.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 ps-3 tabular-nums">
                          {formatQuantity(order.quantity)} {unit}
                        </td>
                        <td className="py-2.5 ps-3 tabular-nums">{d.config.sizingMode === "risk" ? `${formatQuantity(d.config.riskPercentage ?? 1)}%` : d.config.sizingMode === "percentage" ? `${formatQuantity(d.config.percentage ?? 100)}%` : "—"}</td>
                        <td className="py-2.5 ps-3 tabular-nums">{d.config.sizingMode === "multiplier" ? `${formatQuantity(d.config.multiplier ?? 1)}x` : "—"}</td>
                        <td className="py-2.5 ps-3">
                          <button type="button" onClick={() => setWhy(d.accountId)} className="text-start hover:underline" title="Why this size?">
                            {dec.allowed ? <span className="font-semibold tabular-nums">{formatQuantity(dec.finalQuantity)}</span> : <span className="font-semibold text-[var(--loss)]">Not copied</span>}
                            {dec.allowed && dec.calculatedQuantity != null && Math.abs(dec.calculatedQuantity - dec.finalQuantity) > 1e-9 && <span className="ms-1 text-xs text-muted-foreground">(calc. {formatQuantity(Math.round(dec.calculatedQuantity * 100) / 100)})</span>}
                          </button>
                        </td>
                        <td className="py-2.5 ps-3 tabular-nums">{d.config.maxPositionSize ?? "—"}</td>
                        <td className="py-2.5 ps-3">{roundingLabel(d.config.roundingRule)}</td>
                        <td className="py-2.5 ps-3">
                          <Pill tone={STATUS[st.status].tone}>{d.config.enabled ? STATUS[st.status].label : "Off"}</Pill>
                        </td>
                        <td className="py-2.5 ps-3 text-end">
                          <button type="button" className={linkBtn} onClick={() => setEditing(d.accountId)}>
                            Advanced
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {drafts.map((d) => {
                const a = account(d.accountId)
                const dec = decisions.get(d.accountId)!
                const st = riskStatus(d.config, { equity: a?.equity ?? null, dayPnl: a?.dayPnl ?? 0, openNotional: 0, openQuantity: 0, connected: isOnline(a) }, limits.respectPropSync ? a?.propSync : undefined)
                return (
                  <li key={d.accountId} className="space-y-2.5 rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold">{a?.name ?? "Deleted account"}</p>
                      <Pill tone={STATUS[st.status].tone}>{d.config.enabled ? STATUS[st.status].label : "Off"}</Pill>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      {[
                        ["Balance", money(a?.balance)],
                        ["Copy mode", sizingLabel(d.config.sizingMode)],
                        ["Leader size", `${formatQuantity(order.quantity)} ${unit}`],
                        ["Follower size", dec.allowed ? `${formatQuantity(dec.finalQuantity)} ${unitLabel(specFor(dec.symbol), dec.finalQuantity)}` : "Not copied"],
                        ["Ratio", ratioText(d.config)],
                        ["Risk", st.note],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-xs text-muted-foreground">{k}</dt>
                          <dd className="font-medium">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {!dec.allowed && <p className="text-xs text-[var(--loss)]">{dec.reason}</p>}
                    <button type="button" className={cn(linkBtn, "w-full")} onClick={() => setEditing(d.accountId)}>
                      Edit
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Section>

      {drafts.length > 0 && (
        <Section title="Risk preview calculator" description="Size one account purely by risk: its own equity, the stop, and the contract — whatever the Leader's quantity.">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Follower account
              <select className={fieldClass} value={calcDraft?.accountId ?? ""} onChange={(e) => setCalcAccount(Number(e.target.value))}>
                {drafts.map((d) => (
                  <option key={d.accountId} value={d.accountId}>
                    {account(d.accountId)?.name}
                  </option>
                ))}
              </select>
            </label>
            <Num label="Follower risk" value={calcRisk} suffix="%" onChange={setCalcRisk} />
            <Num label="Entry price" value={order.entry} onChange={(v) => setOrder({ ...order, entry: v })} />
            <Num label="Stop loss" value={order.stopLoss} onChange={(v) => setOrder({ ...order, stopLoss: v })} />
          </div>
          {leaderRisk.riskPerUnit == null ? (
            <p className="text-sm text-muted-foreground">{order.entry == null || order.stopLoss == null ? "Enter an entry price and a stop loss." : leaderRisk.why}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              {[
                ["Leader risk", `${money(order.quantity * leaderRisk.riskPerUnit)}${leader?.equity ? ` (${((order.quantity * leaderRisk.riskPerUnit * 100) / leader.equity).toFixed(2)}%)` : ""}`],
                ["Risk per " + unitLabel(spec, 1), money(leaderRisk.riskPerUnit)],
                ["Follower risk budget", calc?.riskAmount != null || calc?.calculatedQuantity != null ? money(((account(calcDraft!.accountId)?.equity ?? 0) * (calcRisk ?? 0)) / 100) : "—"],
                ["Calculated quantity", calc?.calculatedQuantity != null ? formatQuantity(Math.round(calc.calculatedQuantity * 100) / 100) : "—"],
                ["Final quantity", calc?.allowed ? formatQuantity(calc.finalQuantity) : "Not copied"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border p-2.5">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {calc && !calc.allowed && leaderRisk.riskPerUnit != null && <p className="text-sm text-[var(--loss)]">{calc.reason}</p>}
        </Section>
      )}

      {dirty && (
        <div className="sticky bottom-16 z-20 flex items-center justify-between gap-3 rounded-xl border bg-popover p-3 shadow-lg md:bottom-4">
          <p className="text-sm">You have changes that aren&apos;t saved. The engine keeps using the saved settings until you save.</p>
          <button type="button" disabled={pending} className={linkBtnPrimary} onClick={save}>
            {pending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}

      <Sheet open={why != null} onClose={() => setWhy(null)} title={why != null ? `Why ${account(why)?.name ?? "this account"} gets this size` : ""} description="Each step the engine takes, in order.">
        {why != null && decisions.get(why) && (
          <>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Follower size</p>
              <Outcome d={decisions.get(why)!} side={order.side} big />
            </div>
            <Why d={decisions.get(why)!} />
            {!decisions.get(why)!.allowed && <p className="rounded-lg border border-[var(--loss)]/40 bg-[var(--loss)]/10 p-3 text-sm">{decisions.get(why)!.reason}</p>}
          </>
        )}
      </Sheet>

      <Sheet
        open={!!current}
        onClose={() => setEditing(null)}
        title={current ? (account(current.accountId)?.name ?? "Follower") : ""}
        description="Sizing and limits for this account only."
        footer={
          current ? (
            <>
              <button type="button" className={linkBtnPrimary} onClick={() => setEditing(null)}>
                Done
              </button>
              <button
                type="button"
                className={cn(linkBtn, "ms-auto text-[var(--loss)]")}
                onClick={() => {
                  setDrafts((list) => list.filter((d) => d.accountId !== current.accountId))
                  setEditing(null)
                }}
              >
                <Trash2 className="size-3.5" /> Remove follower
              </button>
            </>
          ) : undefined
        }
      >
        {current && <Advanced draft={current} group={group} account={account(current.accountId)} decision={decisions.get(current.accountId)!} side={order.side} leaderSymbol={order.symbol.toUpperCase()} patch={(p) => patch(current.accountId, p)} setMappings={(mappings) => setDrafts((list) => list.map((d) => (d.accountId === current.accountId ? { ...d, mappings } : d)))} />}
      </Sheet>

      <ChangeLeaderDialog open={leaderDialog} onClose={() => setLeaderDialog(false)} group={group} />
    </>
  )
}

function Advanced({ draft, group, account, decision, side, leaderSymbol, patch, setMappings }: { draft: Draft; group: GroupView; account: AccountView | undefined; decision: Decision; side: LeaderOrder["side"]; leaderSymbol: string; patch: (p: Partial<FollowerConfig>) => void; setMappings: (m: Draft["mappings"]) => void }) {
  const c = draft.config
  const lost = Math.max(0, -(account?.dayPnl ?? 0))
  const suggestion = relatedSymbol(leaderSymbol)
  const mapped = draft.mappings.find((m) => m.leaderSymbol === leaderSymbol)
  const symbols = [...new Set([...group.contracts.map((x) => x.symbol), leaderSymbol])]
  return (
    <>
      <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <span>
          <span className="font-medium">Copy to this account</span>
          <span className="block text-xs text-muted-foreground">Off: no new trades are copied here. The other accounts are not affected.</span>
        </span>
        <Toggle checked={c.enabled} onChange={(v) => patch({ enabled: v })} label="Copy to this account" />
      </label>

      <div className="rounded-lg bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground">With the example above, this account would</p>
        <Outcome d={decision} side={side} big />
        {!decision.allowed && <p className="mt-1 text-xs text-[var(--loss)]">{decision.reason}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Copy mode
          <select className={fieldClass} value={c.sizingMode} onChange={(e) => patch({ sizingMode: e.target.value as SizingMode })}>
            {SIZING_MODES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="font-normal">{SIZING_MODES.find((m) => m.key === c.sizingMode)!.hint}</span>
        </label>
        <ModeValue config={c} set={patch} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Rounding
          <select className={fieldClass} value={c.roundingRule} onChange={(e) => patch({ roundingRule: e.target.value as RoundingRule })}>
            {ROUNDING_RULES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <span className="font-normal">Futures trade in whole contracts. If the size rounds to 0, the trade isn&apos;t copied.</span>
        </label>
        <Num label="Minimum quantity" value={c.minQuantity} placeholder="None" onChange={(v) => patch({ minQuantity: v })} />
        <Num label="Maximum position size" value={c.maxPositionSize} placeholder="No limit" onChange={(v) => patch({ maxPositionSize: v })} />
        <Num label="Maximum daily loss" value={c.maxDailyLoss} suffix="$" placeholder="No limit" onChange={(v) => patch({ maxDailyLoss: v })} />
        <Num label="Maximum exposure (notional ÷ equity)" value={c.maxExposure} suffix="%" placeholder="No limit" onChange={(v) => patch({ maxExposure: v })} className="sm:col-span-2" />
      </div>
      {c.maxDailyLoss != null && (
        <p className="text-xs text-muted-foreground">
          Today: {money(lost)} lost, {money(Math.max(0, c.maxDailyLoss - lost))} remaining. A copy that could lose more than what remains is blocked.
        </p>
      )}
      {c.maxExposure != null && <p className="text-xs text-muted-foreground">Futures are leveraged: one NQ contract is roughly $400,000–$500,000 of notional value, so a futures account&apos;s exposure is usually several hundred percent.</p>}

      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">Symbol mapping</p>
        <p className="text-xs text-muted-foreground">Trade the Leader&apos;s symbol under another name on this account — a micro contract, or a broker&apos;s own name for the same market.</p>
        {draft.mappings.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <select aria-label="Leader symbol" className={cn(fieldClass, "flex-1")} value={m.leaderSymbol} onChange={(e) => setMappings(draft.mappings.map((x, k) => (k === i ? { ...x, leaderSymbol: e.target.value } : x)))}>
              {[...new Set([...symbols, m.leaderSymbol])].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <span aria-hidden>→</span>
            <input aria-label="Follower symbol" className={cn(fieldClass, "flex-1 uppercase")} value={m.followerSymbol} maxLength={20} onChange={(e) => setMappings(draft.mappings.map((x, k) => (k === i ? { ...x, followerSymbol: e.target.value.toUpperCase() } : x)))} />
            <button type="button" aria-label="Remove mapping" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => setMappings(draft.mappings.filter((_, k) => k !== i))}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {!mapped && (
            <button type="button" className={linkBtn} onClick={() => setMappings([...draft.mappings, { leaderSymbol, followerSymbol: suggestion?.symbol ?? "" }])}>
              <Plus className="size-3.5" /> Map {leaderSymbol}
              {suggestion ? ` → ${suggestion.symbol}` : ""}
            </button>
          )}
        </div>
        {mapped && suggestion && mapped.followerSymbol === suggestion.symbol && <p className="text-xs text-muted-foreground">{suggestion.ratio > 1 ? `${suggestion.ratio} ${suggestion.symbol} move as much as 1 ${leaderSymbol}. Set a ${suggestion.ratio}x multiplier to keep the same exposure.` : `1 ${suggestion.symbol} moves as much as ${1 / suggestion.ratio} ${leaderSymbol}.`}</p>}
      </div>
    </>
  )
}
