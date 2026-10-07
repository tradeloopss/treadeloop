"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { changeCopyLeader, createCopyGroup, detachCopyAccount, importCopyContract, setCopyAccountRole } from "@/app/actions/copy-trading"
import { ConnectFlow } from "@/components/metatrader-connect"
import { ConnectForm } from "@/components/rithmic-connect"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatQuantity, searchContracts } from "@/lib/copy/contracts"
import { DEFAULT_FOLLOWER, DEFAULT_RULES, RULE_TOGGLES, SIZING_MODES, activationProblems, sizingLabel, type CopyRules, type FollowerConfig, type SizingMode } from "@/lib/copy/engine"
import { ROLE_LABELS, ago, money, type AccountView, type ComplianceProblem, type GroupView, type Role } from "@/lib/copy/view"
import { checkCopyGroup } from "@/app/actions/compliance"
import { SafeMode } from "@/components/compliance/safe-mode"
import type { ProviderProfile } from "@/lib/compliance/engine"
import { helpHref } from "@/lib/urls"
import { Sheet, useAction } from "@/components/insights/client"
import { Rows, fieldClass, linkBtn, linkBtnPrimary } from "@/components/insights/ui"
import { useCopy } from "./store"
import { ConfirmDialog, HealthPill, Heartbeat, RolePill, Toggle, isOnline } from "./ui"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// What a group copies, and when. Used by the wizard and by the Cockpit.
// `only` shows one part of them, for the phone's single-purpose settings screens.
const PROTECTION: (keyof CopyRules)[] = ["stopLoss", "takeProfit", "trailingStop", "modifications"]
export function RulesEditor({ value, onChange, only }: { value: CopyRules; onChange: (next: CopyRules) => void; only?: "protection" | "symbols" }) {
  const set = (patch: Partial<CopyRules>) => onChange({ ...value, ...patch })
  const toggles = only === "protection" ? RULE_TOGGLES.filter((r) => PROTECTION.includes(r.key)) : only === "symbols" ? [] : RULE_TOGGLES
  if (only === "symbols")
    return (
      <div className="space-y-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Which symbols are copied
          <select className={cn(fieldClass, "h-11")} value={value.symbolScope} onChange={(e) => set({ symbolScope: e.target.value as CopyRules["symbolScope"] })}>
            <option value="selected">Selected symbols (the group&apos;s contracts)</option>
            <option value="all">All symbols</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Direction
          <select className={cn(fieldClass, "h-11")} value={value.direction} onChange={(e) => set({ direction: e.target.value as CopyRules["direction"] })}>
            <option value="both">Long + Short</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </select>
        </label>
      </div>
    )
  return (
    <div className="space-y-4">
      <ul className={cn("grid gap-x-4 gap-y-2.5", !only && "sm:grid-cols-2")}>
        {toggles.map((r) => (
          <li key={r.key} className={cn("flex items-center justify-between gap-3 text-sm", only && "min-h-11")}>
            <span>{r.label}</span>
            <Toggle checked={value[r.key] as boolean} onChange={(v) => set({ [r.key]: v } as Partial<CopyRules>)} label={r.label} />
          </li>
        ))}
      </ul>
      {only === "protection" && <p className="text-xs text-muted-foreground">A follower&apos;s stop and target are placed at the Leader&apos;s prices, or the same distance from its own entry when the two trade at different prices.</p>}
      <div className={cn("grid gap-3 border-t pt-4 sm:grid-cols-2", only && "hidden")}>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Direction
          <select className={fieldClass} value={value.direction} onChange={(e) => set({ direction: e.target.value as CopyRules["direction"] })}>
            <option value="both">Long + Short</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Symbols
          <select className={fieldClass} value={value.symbolScope} onChange={(e) => set({ symbolScope: e.target.value as CopyRules["symbolScope"] })}>
            <option value="selected">Selected symbols (the group&apos;s contracts)</option>
            <option value="all">All symbols</option>
          </select>
        </label>
        <fieldset className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          <legend className="mb-1">Trading hours (your time; leave empty for any time)</legend>
          <div className="flex items-center gap-2">
            <input type="time" aria-label="From" className={fieldClass} value={value.hoursFrom ?? ""} onChange={(e) => set({ hoursFrom: e.target.value || null })} />
            <span aria-hidden>→</span>
            <input type="time" aria-label="To" className={fieldClass} value={value.hoursTo ?? ""} onChange={(e) => set({ hoursTo: e.target.value || null })} />
          </div>
        </fieldset>
        <fieldset className="text-xs font-medium text-muted-foreground">
          <legend className="mb-1">Days</legend>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d, i) => {
              const on = value.days.includes(i)
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => set({ days: on ? value.days.filter((x) => x !== i) : [...value.days, i].sort() })} className={cn("h-8 rounded-md border px-2 text-xs font-semibold", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
                  {d}
                </button>
              )
            })}
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-muted-foreground">Filters apply to new entries. A close is always copied to a follower that holds the position, so nobody is left in a trade the Leader has left.</p>
    </div>
  )
}

// Search the contracts TradeLoop knows the specification of, and pick from them.
export function ContractPicker({ taken, onPick, pending }: { taken: string[]; onPick: (symbol: string) => void; pending?: boolean }) {
  const [query, setQuery] = useState("")
  const results = useMemo(() => searchContracts(query), [query])
  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Search contracts</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input autoFocus className={cn(fieldClass, "ps-8 uppercase")} placeholder="Search: NQ, MNQ, ES, EURUSD, gold…" value={query} maxLength={30} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {!query.trim() ? (
        <p className="text-sm text-muted-foreground">Type a symbol or a name. Futures list their next expirations.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches “{query}”.</p>
      ) : (
        <ul className="max-h-[22rem] divide-y overflow-y-auto rounded-lg border">
          {results.map((c) => {
            const have = taken.includes(c.symbol)
            return (
              <li key={c.symbol} className="flex items-center gap-3 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {c.symbol} <span className="font-normal text-muted-foreground">{c.name === c.symbol ? "" : c.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.known ? (
                      <>
                        {[c.exchange, c.type === "future" ? "Future" : c.type === "forex" ? "Forex" : "Metal", c.expiration ? `Expires ${c.expiration}` : null, `Tick ${c.tickSize}`, c.tickValue != null ? `Tick value $${formatQuantity(c.tickValue)}` : "Tick value depends on price", `Min ${formatQuantity(c.minimumQuantity)}`].filter(Boolean).join(" · ")}
                      </>
                    ) : (
                      "Contract size not known: it can be copied by quantity, but not sized by Risk %."
                    )}
                  </p>
                </div>
                <button type="button" disabled={have || pending} className={have ? linkBtn : linkBtnPrimary} onClick={() => onPick(c.symbol)}>
                  {have ? "Imported" : "Import"}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function ContractDialog({ open, onClose, group }: { open: boolean; onClose: () => void; group: GroupView }) {
  const { refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import a contract</DialogTitle>
          <DialogDescription>Trades in an imported contract are copied by “{group.name}”.</DialogDescription>
        </DialogHeader>
        <ContractPicker
          pending={pending}
          taken={group.contracts.map((c) => c.symbol)}
          onPick={(symbol) =>
            run(
              () => importCopyContract(group.id, symbol),
              async (res) => {
                toast.success(`Contract imported: ${res.contract.symbol}`)
                await refresh()
                router.refresh()
              },
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export function ChangeLeaderDialog({ open, onClose, group }: { open: boolean; onClose: () => void; group: GroupView }) {
  const { state, account, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [next, setNext] = useState<number | null>(null)
  const current = account(group.leaderAccountId)
  const options = state.accounts.filter((a) => a.id !== group.leaderAccountId)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Leader</DialogTitle>
          <DialogDescription>Changing the Leader changes the source of future copied trades.</DialogDescription>
        </DialogHeader>
        <Rows rows={[["Current Leader", current?.name ?? "—"]]} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          New Leader
          <select className={fieldClass} value={next ?? ""} onChange={(e) => setNext(Number(e.target.value) || null)}>
            <option value="">Choose an account…</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.platform}
                {group.followers.some((f) => f.accountId === a.id) ? " (now a follower)" : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2.5 text-xs">Positions that are already open are not changed or closed. An account that follows this group stops following it when it becomes the Leader.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={linkBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!next || pending}
            className={linkBtnPrimary}
            onClick={() =>
              run(
                () => changeCopyLeader(group.id, next!),
                async () => {
                  toast.success("Leader changed.")
                  onClose()
                  await refresh()
                  router.refresh()
                },
              )
            }
          >
            {pending ? "Changing…" : "Change Leader"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ create a copy group

const STEPS = ["Name", "Leader", "Followers", "Contracts", "Risk", "Copy rules", "Review", "Activate"]

function AccountOption({ a, checked, onChange, type, disabled, note }: { a: AccountView; checked: boolean; onChange: () => void; type: "radio" | "checkbox"; disabled?: boolean; note?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm", checked && "border-primary bg-primary/5", disabled && "cursor-not-allowed opacity-50")}>
      <input type={type} name={type === "radio" ? "leader" : undefined} className="size-4 accent-[var(--primary)]" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{a.name}</span>
        <span className="block text-xs text-muted-foreground">
          {a.platform} · {money(a.balance)}
          {note ? ` · ${note}` : ""}
        </span>
      </span>
      <HealthPill health={a.health} />
    </label>
  )
}

export function GroupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, refresh, selectGroup } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [leader, setLeader] = useState<number | null>(null)
  const [followers, setFollowers] = useState<{ accountId: number; config: FollowerConfig }[]>([])
  const [contracts, setContracts] = useState<string[]>([])
  const [rules, setRules] = useState<CopyRules>({ ...DEFAULT_RULES })
  const [done, setDone] = useState<{ id: number; activated: boolean; problem?: string } | null>(null)
  // what the providers' rules have against this Master and these Followers (lib/compliance), asked at the review
  const [rulesCheck, setRulesCheck] = useState<{ key: string; problems: ComplianceProblem[] } | null>(null)
  const checkKey = `${leader}:${followers.map((f) => f.accountId).join(",")}`
  useEffect(() => {
    if (step !== 6 || leader == null) return
    let stale = false
    checkCopyGroup(leader, followers.map((f) => f.accountId)).then((res) => {
      if (!stale) setRulesCheck({ key: checkKey, problems: res.ok ? res.problems : [] })
    })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, checkKey])
  const compliance = rulesCheck && rulesCheck.key === checkKey ? rulesCheck.problems : null

  const reset = () => {
    setStep(0)
    setName("")
    setLeader(null)
    setFollowers([])
    setContracts([])
    setRules({ ...DEFAULT_RULES })
    setDone(null)
  }
  const close = () => {
    onClose()
    reset()
  }
  const byId = new Map(state.accounts.map((a) => [a.id, a]))
  const problems = activationProblems({ hasLeader: leader != null, leaderConnected: isOnline(byId.get(leader ?? -1)), followers: followers.map((f) => ({ name: byId.get(f.accountId)?.name ?? "Follower", config: f.config, connected: isOnline(byId.get(f.accountId)) })), contracts: contracts.length, symbolScope: rules.symbolScope })
  const blocked = [name.trim().length < 2 ? "Give the group a name." : null, leader == null ? "Choose a Leader." : null, followers.length === 0 ? "Choose at least one Follower." : null][step] ?? null
  const setMode = (accountId: number, patch: Partial<FollowerConfig>) => setFollowers((list) => list.map((f) => (f.accountId === accountId ? { ...f, config: { ...f.config, ...patch } } : f)))
  const create = (activate: boolean) =>
    run(
      () => createCopyGroup({ name, leaderAccountId: leader!, followers, contracts, rules }, activate),
      async (res) => {
        setDone(res)
        setStep(7)
        toast.success(res.activated ? "Group activated." : "Group created.")
        await refresh()
        router.refresh()
      },
    )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Copy Group</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </DialogDescription>
        </DialogHeader>
        <ol className="flex gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <li key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </ol>

        {state.accounts.length < 2 && step < 7 ? (
          <div className="rounded-lg border border-dashed p-5 text-center text-sm">
            <p className="font-medium">A copy group needs at least two accounts.</p>
            <p className="mt-1 text-muted-foreground">One to lead and one to follow. You have {state.accounts.length}.</p>
            <Link href="/copy-trading/connection" className={cn(linkBtnPrimary, "mt-3")} onClick={close}>
              Connect an account
            </Link>
          </div>
        ) : (
          <div className="min-h-48 space-y-3">
            {step === 0 && (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Group name
                <input autoFocus className={fieldClass} maxLength={60} placeholder="US Futures Portfolio" value={name} onChange={(e) => setName(e.target.value)} />
                <span className="text-xs font-normal text-muted-foreground">For example: Forex Portfolio, Gold Strategy, Evaluation Accounts, Funded Accounts.</span>
              </label>
            )}
            {step === 1 && (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Which account do the others copy?</legend>
                {state.accounts.map((a) => (
                  <AccountOption
                    key={a.id}
                    a={a}
                    type="radio"
                    checked={leader === a.id}
                    onChange={() => {
                      setLeader(a.id)
                      setFollowers((list) => list.filter((f) => f.accountId !== a.id))
                    }}
                  />
                ))}
              </fieldset>
            )}
            {step === 2 && (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Which accounts copy it?</legend>
                {state.accounts.filter((a) => a.id !== leader).map((a) => {
                  const on = followers.some((f) => f.accountId === a.id)
                  return <AccountOption key={a.id} a={a} type="checkbox" checked={on} note={state.mode === "live" && !a.canExecute ? "can't receive live orders" : undefined} onChange={() => setFollowers((list) => (on ? list.filter((f) => f.accountId !== a.id) : [...list, { accountId: a.id, config: { ...DEFAULT_FOLLOWER } }]))} />
                })}
              </fieldset>
            )}
            {step === 3 && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {contracts.length === 0 && <p className="text-sm text-muted-foreground">Import a contract to start copying trades — or skip this and set the group to copy all symbols in the next steps.</p>}
                  {contracts.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 ps-2.5 pe-1 text-sm font-medium">
                      {s}
                      <button type="button" aria-label={`Remove ${s}`} className="flex size-5 items-center justify-center rounded-full hover:bg-muted" onClick={() => setContracts((list) => list.filter((x) => x !== s))}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <ContractPicker taken={contracts} onPick={(s) => setContracts((list) => [...list, s])} />
              </>
            )}
            {step === 4 && (
              <ul className="space-y-2.5">
                <li className="text-sm text-muted-foreground">How much does each follower copy? You can fine-tune limits, rounding and symbol mapping later in Risk Management.</li>
                {followers.map((f) => (
                  <li key={f.accountId} className="grid items-end gap-2 rounded-lg border p-2.5 sm:grid-cols-[1fr_10rem_8rem]">
                    <p className="min-w-0 truncate text-sm font-medium sm:pb-2">{byId.get(f.accountId)?.name}</p>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                      Copy mode
                      <select className={fieldClass} value={f.config.sizingMode} onChange={(e) => setMode(f.accountId, { sizingMode: e.target.value as SizingMode })}>
                        {SIZING_MODES.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {f.config.sizingMode === "same" ? (
                      <p className="pb-2 text-xs text-muted-foreground">1 : 1</p>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                        {f.config.sizingMode === "percentage" ? "% of Leader" : f.config.sizingMode === "multiplier" ? "Multiplier" : f.config.sizingMode === "risk" ? "Risk %" : f.config.sizingMode === "fixed" ? "Quantity" : "% of size ratio"}
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className={fieldClass}
                          value={(f.config.sizingMode === "percentage" ? f.config.percentage : f.config.sizingMode === "multiplier" ? f.config.multiplier : f.config.sizingMode === "risk" ? f.config.riskPercentage : f.config.sizingMode === "fixed" ? f.config.fixedQuantity : f.config.customFactor) ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value)
                            setMode(f.accountId, f.config.sizingMode === "percentage" ? { percentage: v } : f.config.sizingMode === "multiplier" ? { multiplier: v } : f.config.sizingMode === "risk" ? { riskPercentage: v } : f.config.sizingMode === "fixed" ? { fixedQuantity: v } : { customFactor: v })
                          }}
                        />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {step === 5 && <RulesEditor value={rules} onChange={setRules} />}
            {step === 6 && (
              <>
                <Rows
                  rows={[
                    ["Group", name],
                    ["Leader", byId.get(leader ?? -1)?.name ?? "—"],
                    ["Followers", followers.map((f) => `${byId.get(f.accountId)?.name} (${sizingLabel(f.config.sizingMode)})`).join(", ") || "—"],
                    ["Contracts", rules.symbolScope === "all" ? "All symbols" : contracts.join(", ") || "None"],
                    ["Direction", rules.direction === "both" ? "Long + Short" : rules.direction === "long" ? "Long only" : "Short only"],
                    ["Hours", rules.hoursFrom && rules.hoursTo ? `${rules.hoursFrom} → ${rules.hoursTo}` : "Any time"],
                    ["Days", rules.days.map((d) => DAYS[d]).join(", ")],
                    ["Execution", state.mode === "live" ? "Live — orders are sent to brokers" : "Simulation — nothing is sent to a broker"],
                  ]}
                />
                {compliance && compliance.length > 0 ? (
                  <div role="alert" className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm">
                    <p className="font-semibold">This Copy Group cannot be created</p>
                    <ul className="mt-1 space-y-1">
                      {compliance.map((p) => (
                        <li key={`${p.accountId}${p.reasonCode}`}>
                          <span className="font-medium">{byId.get(p.accountId)?.name ?? "Account"}:</span> {p.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className={cn("size-4", compliance ? "text-[var(--gain)]" : "opacity-40")} aria-hidden /> {compliance ? "Provider rules: nothing against this Master and these Followers." : "Checking the provider rules…"}
                  </p>
                )}
                {problems.length > 0 ? (
                  <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm">
                    <p className="font-medium">This group can be saved, but not activated yet:</p>
                    <ul className="mt-1 list-disc space-y-0.5 ps-5">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-[var(--gain)]">
                    <Check className="size-4" aria-hidden /> Ready to activate.
                  </p>
                )}
              </>
            )}
            {step === 7 && done && (
              <div className="rounded-lg border p-5 text-center">
                <p className="text-base font-semibold">{done.activated ? `“${name}” is copying.` : `“${name}” was saved as a draft.`}</p>
                <p className="mt-1 text-sm text-muted-foreground">{done.activated ? (state.mode === "live" ? "New trades on the Leader are sent to the followers." : "Simulation: new trades on the Leader are worked out for each follower and recorded.") : (done.problem ?? "Activate it from the Cockpit when you are ready.")}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link href={`/copy-trading/cockpit?group=${done.id}`} className={linkBtnPrimary} onClick={close}>
                    Open Cockpit
                  </Link>
                  <Link href={`/copy-trading/risk-management?group=${done.id}`} className={linkBtn} onClick={close}>
                    Risk Management
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {state.accounts.length >= 2 && step < 7 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {step > 0 && (
              <button type="button" className={linkBtn} onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
            <span className="ms-auto flex gap-2">
              {step < 6 ? (
                <button type="button" disabled={!!blocked} className={linkBtnPrimary} onClick={() => setStep(step + 1)}>
                  Next
                </button>
              ) : (
                <>
                  <button type="button" disabled={pending || !compliance || compliance.length > 0} className={linkBtn} onClick={() => create(false)}>
                    Save as draft
                  </button>
                  <button type="button" disabled={pending || problems.length > 0 || !compliance || compliance.length > 0} className={linkBtnPrimary} onClick={() => create(true)}>
                    {pending ? "Creating…" : "Activate"}
                  </button>
                </>
              )}
            </span>
          </div>
        )}
        {step === 7 && done && (
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => (selectGroup(done.id), close())}>
            Close
          </button>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ connect an account

const PLATFORMS: { key: string; label: string; note: string }[] = [
  { key: "mt5", label: "MetaTrader 5", note: "Read-only investor password. Orders need the master password, added separately." },
  { key: "mt4", label: "MetaTrader 4", note: "Read-only investor password. Can lead a group; can't receive orders yet." },
  { key: "rithmic", label: "Rithmic", note: "Futures prop firms. Can lead a group; can't receive orders yet." },
  { key: "tradingview", label: "TradingView", note: "Paper trading, through the TradeLoop browser extension." },
  { key: "other", label: "Tradovate, CSV and others", note: "Every other TradeLoop connection." },
]
const ROLES: Role[] = ["leader", "follower", "both"]

// Connect Account: the platform, TradeLoop's own connection form for it, a
// check that the account came through, and what it will be used for.
export function ConnectAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [step, setStep] = useState(0)
  const [platform, setPlatform] = useState<string | null>(null)
  const [before, setBefore] = useState<number[]>([])
  const [role, setRole] = useState<Role>("follower")
  // A provider whose rules keep TradeLoop from connecting to its accounts
  // (lib/compliance) is listed all the same: what it allows, and the way round
  // that its own copier offers. The account then connected is the relay one.
  const restricted = state.providers.filter((p) => !p.connection.allowed)
  const provider = restricted.find((p) => platform === `provider:${p.provider}`) ?? null
  const [relay, setRelay] = useState<ProviderProfile | null>(null)
  const [checking, setChecking] = useState(false)
  const added = state.accounts.filter((a) => !before.includes(a.id))
  const account = added[0]
  const close = () => {
    onClose()
    setStep(0)
    setPlatform(null)
    setRelay(null)
  }
  const check = async () => {
    setChecking(true)
    await refresh()
    router.refresh()
    setChecking(false)
  }
  const connected = async () => {
    setStep(2)
    await check()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect Account</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 5: {provider && step === 1 ? `How ${provider.name} is copied` : ["Choose platform", "Authenticate", "Test connection", "Choose role", "Complete"][step]}
          </DialogDescription>
        </DialogHeader>
        {step === 0 && (
          <ul className="space-y-2">
            {[...PLATFORMS, ...restricted.map((p) => ({ key: `provider:${p.provider}`, label: `${p.name} account`, note: `${p.statusLabel}. TradeLoop doesn't connect to it: see what its rules allow${p.ownCopier ? ", and the way round" : ""}.` }))].map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  className="w-full rounded-lg border p-3 text-start transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    setPlatform(p.key)
                    setRelay(null)
                    setBefore(state.accounts.map((a) => a.id))
                    setStep(1)
                  }}
                >
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.note}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {step === 1 && (
          <div className="space-y-3">
            {/* TradeLoop's own connection forms: the same ones as on the Accounts page */}
            {provider && (
              <div className="space-y-3 text-sm">
                <SafeMode profile={provider} />
                {provider.ownCopier && provider.lines.some((l) => l.key === "ownToOwn" && l.allowed) && (
                  <div className="rounded-lg border p-3">
                    <p className="font-medium">Between your own {provider.name} accounts</p>
                    <p className="mt-1 text-muted-foreground">Use {provider.ownCopier.name}. TradeLoop takes no part in it.</p>
                  </div>
                )}
                {provider.ownCopier && provider.lines.some((l) => l.key === "toExternal" && l.allowed) && (
                  <div className="rounded-lg border p-3">
                    <p className="font-medium">From {provider.name} to your other accounts</p>
                    <ol className="mt-1 list-decimal space-y-1 ps-5 text-muted-foreground">
                      <li>
                        In {provider.ownCopier.name}, add an ordinary broker account as a Follower of your {provider.name} account. That is your relay account.
                      </li>
                      <li>Connect the relay account here.</li>
                      <li>Make it the Leader of a Copy Group. Your other accounts follow it.</li>
                    </ol>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className={linkBtn} onClick={() => setStep(0)}>
                    Back
                  </button>
                  <span className="flex flex-wrap gap-2">
                    {provider.guide && (
                      <a href={helpHref(provider.guide)} target="_blank" rel="noreferrer" className={linkBtn}>
                        Read the guide
                      </a>
                    )}
                    {provider.ownCopier && provider.lines.some((l) => l.key === "toExternal" && l.allowed) && (
                      <button
                        type="button"
                        className={linkBtnPrimary}
                        onClick={() => {
                          setRelay(provider)
                          setRole("leader")
                          setPlatform("mt5")
                        }}
                      >
                        Connect the relay account
                      </button>
                    )}
                  </span>
                </div>
              </div>
            )}
            {relay && platform === "mt5" && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
                The relay account: the broker account {relay.ownCopier?.name ?? `${relay.name}'s copier`} copies to. Not the {relay.name} account itself.
              </p>
            )}
            {(platform === "mt5" || platform === "mt4") && <ConnectFlow initial={{ platform }} lockPlatform onDone={connected} onBack={() => (setRelay(null), setStep(0))} />}
            {platform === "rithmic" && <ConnectForm onDone={connected} />}
            {(platform === "tradingview" || platform === "other") && (
              <div className="rounded-lg border border-dashed p-4 text-sm">
                <p>{platform === "tradingview" ? "TradingView is paired from the Accounts page, with the TradeLoop browser extension." : "Tradovate, CSV imports and manual accounts are set up on the Accounts page."}</p>
                <p className="mt-1 text-muted-foreground">Once the account is there it appears on this page, ready to be given a role.</p>
                <Link href={platform === "tradingview" ? "/accounts?connect=tradingview" : "/accounts"} className={cn(linkBtnPrimary, "mt-3")}>
                  Open Accounts
                </Link>
              </div>
            )}
            {platform === "rithmic" && (
              <button type="button" className={linkBtn} onClick={() => setStep(0)}>
                Back
              </button>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            {account ? (
              <div className="rounded-lg border p-3">
                <p className="text-sm font-semibold">{account.name}</p>
                <p className="text-xs text-muted-foreground">
                  {account.platform} · {money(account.balance)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <HealthPill health={account.health} />
                  <Heartbeat account={account} />
                </div>
                {account.health === "syncing" && <p className="mt-2 text-xs text-muted-foreground">The first sync is still running. You can carry on; the status updates by itself.</p>}
                {(account.health === "disconnected" || account.health === "auth") && <p className="mt-2 text-xs text-[var(--loss)]">{account.healthNote ?? "The connection didn't come up."} Check the login details on the Accounts page.</p>}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">The new account hasn&apos;t appeared yet. A first sync can take a minute.</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={checking} className={linkBtn} onClick={check}>
                {checking ? "Checking…" : "Test again"}
              </button>
              <button type="button" disabled={!account} className={linkBtnPrimary} onClick={() => setStep(3)}>
                Next
              </button>
            </div>
          </div>
        )}
        {step === 3 && account && (
          <div className="space-y-3">
            {relay && <p className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">A relay account leads: it receives your {relay.name} trades, and your other accounts copy it.</p>}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">What is {account.name} for?</legend>
              {ROLES.map((r) => (
                <label key={r} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm", role === r && "border-primary bg-primary/5")}>
                  <input type="radio" name="role" className="mt-0.5 size-4 accent-[var(--primary)]" checked={role === r} onChange={() => setRole(r)} />
                  <span>
                    <span className="block font-medium">{ROLE_LABELS[r]}</span>
                    <span className="block text-xs text-muted-foreground">{r === "leader" ? "Other accounts copy what it trades." : r === "follower" ? "It copies a Leader, within its own risk limits." : "It can lead one group and follow another."}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted-foreground">A role isn&apos;t permanent: an account can be a Leader in one Copy Group and a Follower in another.</p>
            <div className="flex justify-end">
              <button type="button" disabled={pending} className={linkBtnPrimary} onClick={() => run(() => setCopyAccountRole(account.id, role), async () => (toast.success("Account connected."), await refresh(), setStep(4)))}>
                {pending ? "Saving…" : "Next"}
              </button>
            </div>
          </div>
        )}
        {step === 4 && account && (
          <div className="rounded-lg border p-5 text-center">
            <Check className="mx-auto size-6 text-[var(--gain)]" aria-hidden />
            <p className="mt-2 text-base font-semibold">{account.name} is ready.</p>
            <p className="mt-1 text-sm text-muted-foreground">Add it to a Copy Group to start using it as a {ROLE_LABELS[role].toLowerCase()}.</p>
            <button type="button" className={cn(linkBtnPrimary, "mt-4")} onClick={close}>
              Done
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// One account in detail: its connection, its balance, what it is used for.
export function AccountDrawer({ accountId, onClose }: { accountId: number | null; onClose: () => void }) {
  const { state, account, refresh } = useCopy()
  const router = useRouter()
  const { pending, run } = useAction()
  const [confirm, setConfirm] = useState(false)
  const a = accountId != null ? account(accountId) : undefined
  const positions = a ? state.positions.filter((p) => p.accountId === a.id && !p.simulated) : []
  const after = async () => {
    await refresh()
    router.refresh()
  }
  return (
    <>
      <Sheet
        open={!!a}
        onClose={onClose}
        title={a?.name ?? ""}
        description={a ? `${a.platform}${a.login ? ` · ${a.login}` : ""}` : undefined}
        footer={
          a ? (
            <>
              <Link href="/accounts" className={linkBtn}>
                Reconnect
              </Link>
              <button type="button" disabled={pending || a.groups.length === 0} className={cn(linkBtn, "text-[var(--loss)]")} onClick={() => setConfirm(true)}>
                Disconnect
              </button>
            </>
          ) : undefined
        }
      >
        {a && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <HealthPill health={a.health} />
              <RolePill role={a.role} />
              <Heartbeat account={a} />
            </div>
            {a.healthNote && a.health !== "connected" && <p className="rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground">{a.healthNote}</p>}
            {state.providers.filter((p) => p.provider === a.provider).map((p) => (
              <SafeMode key={p.provider} profile={p} />
            ))}
            <Rows
              rows={[
                ["Broker", a.broker ?? "—"],
                ["Platform", a.platform],
                ["Connection", a.connectedBy],
                ["Authentication", a.authentication ?? "—"],
                ["Account ID", a.login ?? "—"],
                ["Balance", money(a.balance)],
                ["Equity", money(a.equity)],
                ["Margin", "Not reported by this connection"],
                ["Open positions", String(a.openPositions)],
                ["Day P&L", money(a.dayPnl, true)],
                ["Latency", a.latencyMs != null ? `${a.latencyMs}ms` : "Not reported by this connection"],
                ["Last heartbeat", ago(a.heartbeatAt)],
                ["Orders", a.canExecute ? "Can receive orders" : a.executionNote],
                a.propSync.tracked && ["PropSync", a.propSync.blocked ? (a.propSync.reason ?? "Blocked") : a.propSync.dailyLossRemaining != null ? `${money(a.propSync.dailyLossRemaining)} of daily loss remaining` : "Within its rules"],
              ]}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Role
              <select className={fieldClass} disabled={pending} value={a.preferredRole} onChange={(e) => run(() => setCopyAccountRole(a.id, e.target.value), after)}>
                {(["leader", "follower", "both", "unassigned"] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted-foreground">What you intend the account for. Inside a group it is whatever that group makes it.</span>
            </label>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Groups</p>
              {a.groups.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Not in a Copy Group yet.</p>
              ) : (
                <ul className="mt-1 divide-y text-sm">
                  {a.groups.map((g) => (
                    <li key={`${g.id}${g.as}`} className="flex items-center justify-between gap-2 py-1.5">
                      <Link href={`/copy-trading/cockpit?group=${g.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {g.name}
                      </Link>
                      <RolePill role={g.as} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {positions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Open positions</p>
                <ul className="mt-1 divide-y text-sm">
                  {positions.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5 tabular-nums">
                      <span>
                        {p.side === "long" ? "BUY" : "SELL"} {formatQuantity(p.quantity)} {p.symbol}
                      </span>
                      <span className={cn(p.openPnl != null && p.openPnl > 0 && "text-[var(--gain)]", p.openPnl != null && p.openPnl < 0 && "text-[var(--loss)]")}>{money(p.openPnl, true)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Sheet>
      <ConfirmDialog
        open={confirm && !!a}
        onClose={() => setConfirm(false)}
        title={`Disconnect ${a?.name ?? ""} from Copy Trading?`}
        action="Disconnect"
        danger
        pending={pending}
        onConfirm={() =>
          a &&
          run(
            () => detachCopyAccount(a.id),
            async () => {
              toast.success("Account disconnected from Copy Trading.")
              setConfirm(false)
              await after()
            },
          )
        }
      >
        <p>It is taken out of every group it follows and stops copying. Its positions are not closed.</p>
        <p>The broker connection itself stays: to remove that, use the Accounts page.</p>
      </ConfirmDialog>
    </>
  )
}

