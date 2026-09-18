"use client"

import { useState, useTransition } from "react"
import type React from "react"
import type { PropFirmAccount } from "@/app/actions/propfirm"
import { createManualPropFirmAccount } from "@/app/actions/propfirm"
import { PROP_FIRM_NAMES, getPresetPrograms, type PropFirmPreset } from "@/lib/propfirm-presets"
import { RulesForm } from "@/components/propfirm-tracker"
import { ConnectForm } from "@/components/rithmic-connect"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plus, Search, RefreshCw, PenLine, Star, ChevronLeft, Wifi, Clock, CheckCircle2, Info, FilePlus2, Link2 } from "lucide-react"
import { toast } from "sonner"

type Step = "method" | "manualTarget" | "manualExisting" | "firm" | "manualPlan" | "manualDetails" | "sync" | "connect" | "success"
type Method = "auto" | "manual" | null

// A generic initial-avatar chip — not a real prop firm logo (we don't have
// licensed rights to those), just a deterministic color per name so the same
// firm always gets the same chip. Same approach as account-manager.tsx's
// broker chips.
const CHIP_COLORS = [
  "bg-blue-500/15 text-blue-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-violet-500/15 text-violet-500",
  "bg-amber-500/15 text-amber-500",
  "bg-rose-500/15 text-rose-500",
  "bg-cyan-500/15 text-cyan-500",
]
function chipColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return CHIP_COLORS[Math.abs(hash) % CHIP_COLORS.length]
}
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase()
}

const STEP_ORDER: Record<Step, number> = {
  method: 0,
  manualTarget: 1,
  manualExisting: 2,
  firm: 1,
  manualPlan: 2,
  manualDetails: 3,
  sync: 2,
  connect: 3,
  success: 4,
}

function ProgressBar({ step, method }: { step: Step; method: Method }) {
  const total = method === "manual" ? 4 : 4
  const pct = ((STEP_ORDER[step] + 1) / total) * 100
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" /> Back
    </button>
  )
}

function PresetChips({ preset }: { preset: PropFirmPreset }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {preset.profitTargetPct != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">Target {preset.profitTargetPct}%</span>}
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
        {preset.drawdownType === "trailing" ? "Trailing" : "Static"} DD {preset.maxDrawdownPct}%
      </span>
      {preset.dailyLossLimitPct != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">Daily loss {preset.dailyLossLimitPct}%</span>}
      {preset.minTradingDays != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{preset.minTradingDays}+ days</span>}
    </div>
  )
}

function ManualDetailsForm({
  firm,
  preset,
  onDone,
}: {
  firm: string
  preset: PropFirmPreset | null
  onDone: () => void
}) {
  const [name, setName] = useState("")
  const [startingBalance, setStartingBalance] = useState("")
  const [currentBalance, setCurrentBalance] = useState("")
  const [phase, setPhase] = useState("evaluation")
  const [profitTargetPct, setProfitTargetPct] = useState(preset?.profitTargetPct?.toString() ?? "")
  const [maxDrawdownPct, setMaxDrawdownPct] = useState(preset?.maxDrawdownPct.toString() ?? "")
  const [drawdownType, setDrawdownType] = useState<"trailing" | "static">(preset?.drawdownType ?? "trailing")
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(preset?.dailyLossLimitPct?.toString() ?? "")
  const [minTradingDays, setMinTradingDays] = useState(preset?.minTradingDays?.toString() ?? "")
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("firmName", firm)
    formData.set("planType", preset?.program ?? "")
    formData.set("name", name)
    formData.set("phase", phase)
    formData.set("profitTargetPct", profitTargetPct)
    formData.set("maxDrawdownPct", maxDrawdownPct)
    formData.set("drawdownType", drawdownType)
    formData.set("dailyLossLimitPct", dailyLossLimitPct)
    formData.set("minTradingDays", minTradingDays)
    formData.set("startingBalance", startingBalance)
    formData.set("currentBalance", currentBalance)
    startTransition(async () => {
      try {
        await createManualPropFirmAccount(formData)
        toast.success("Tracking started")
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create this account")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {preset ? (
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">{firm} — {preset.program}</p>
          <PresetChips preset={preset} />
          <p className="text-xs text-muted-foreground">{preset.notes}</p>
        </div>
      ) : (
        <>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            We don&apos;t have {firm} in our presets yet — enter its rules yourself.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="profitTargetPct">Profit target %</Label>
              <Input id="profitTargetPct" type="number" step="0.01" placeholder="Leave blank if none" value={profitTargetPct} onChange={(e) => setProfitTargetPct(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxDrawdownPct">Max drawdown %</Label>
              <Input id="maxDrawdownPct" type="number" step="0.01" required value={maxDrawdownPct} onChange={(e) => setMaxDrawdownPct(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Drawdown type</Label>
              <Select value={drawdownType} onValueChange={(v) => v && setDrawdownType(v as "trailing" | "static")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trailing">Trailing (from peak)</SelectItem>
                  <SelectItem value="static">Static (from starting)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dailyLossLimitPct">Daily loss limit %</Label>
              <Input id="dailyLossLimitPct" type="number" step="0.01" placeholder="Leave blank if none" value={dailyLossLimitPct} onChange={(e) => setDailyLossLimitPct(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="minTradingDays">Min trading days</Label>
            <Input id="minTradingDays" type="number" placeholder="Leave blank if none" value={minTradingDays} onChange={(e) => setMinTradingDays(e.target.value)} />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="pf-name">Account nickname (optional)</Label>
        <Input id="pf-name" placeholder={`e.g. ${firm}${preset ? ` ${preset.program}` : ""}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="startingBalance">Account size</Label>
          <Input id="startingBalance" type="number" step="any" required placeholder="50000" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currentBalance">Current balance</Label>
          <Input id="currentBalance" type="number" step="any" placeholder="Same as size if just started" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        If you&apos;ve already been trading this account elsewhere, enter where it stands today so progress and drawdown start from the right place.
      </p>

      <div className="space-y-1.5">
        <Label>Current situation</Label>
        <Select value={phase} onValueChange={(v) => v && setPhase(v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="evaluation">Evaluation</SelectItem>
            <SelectItem value="verification">Verification</SelectItem>
            <SelectItem value="funded">Funded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Starting…" : "Start tracking"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function TrackPropFirmWizard({ accounts, isPro }: { accounts: PropFirmAccount[]; isPro: boolean }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("method")
  const [method, setMethod] = useState<Method>(null)
  const [search, setSearch] = useState("")
  const [selectedFirm, setSelectedFirm] = useState<string | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<PropFirmPreset | null>(null)
  const [existingAccountId, setExistingAccountId] = useState<number | null>(null)

  const untrackedAccounts = accounts.filter((a) => a.rules == null)
  const selectedExistingAccount = accounts.find((a) => a.id === existingAccountId) ?? null

  function reset() {
    setStep("method")
    setMethod(null)
    setSearch("")
    setSelectedFirm(null)
    setSelectedPreset(null)
    setExistingAccountId(null)
  }

  function close() {
    setOpen(false)
    reset()
  }

  const matchingFirms = PROP_FIRM_NAMES.filter((f) => f.toLowerCase().includes(search.trim().toLowerCase()))
  const programsForFirm = selectedFirm ? getPresetPrograms(selectedFirm) : []

  function pickFirm(firm: string) {
    setSelectedFirm(firm)
    if (method === "manual") {
      const programs = getPresetPrograms(firm)
      if (programs.length > 0) {
        setStep("manualPlan")
      } else {
        setSelectedPreset(null)
        setStep("manualDetails")
      }
    } else {
      setStep("sync")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm"><Plus className="size-4" /> Track prop firm account</Button>} />
      <DialogContent className="sm:max-w-lg">
        <div className="space-y-4">
          <ProgressBar step={step} method={method} />

          {step === "method" && (
            <>
              <DialogHeader>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Track prop firm account</p>
                <DialogTitle>How do you want to add it?</DialogTitle>
              </DialogHeader>
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                <Info className="mt-0.5 size-4 shrink-0" />
                Automatic connect currently supports the Rithmic data feed only.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setMethod("auto")
                    setStep("firm")
                  }}
                  className="flex flex-col items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
                >
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                    <Star className="size-2.5 fill-current" /> Recommended
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><RefreshCw className="size-4.5" /></span>
                  <span className="font-semibold">Automatic connect</span>
                  <p className="text-sm text-muted-foreground">Link your broker login — trades and balance sync in automatically.</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMethod("manual")
                    setStep("manualTarget")
                  }}
                  className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-accent/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><PenLine className="size-4.5" /></span>
                  <span className="font-semibold">Manual entry</span>
                  <p className="text-sm text-muted-foreground">We&apos;ll walk you through the firm, plan, and account details.</p>
                </button>
              </div>
            </>
          )}

          {step === "manualTarget" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("method")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Track prop firm account</p>
                <DialogTitle>New account or an existing one?</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setStep("firm")}
                  className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-accent/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FilePlus2 className="size-4.5" /></span>
                  <span className="font-semibold">New account</span>
                  <p className="text-sm text-muted-foreground">You haven&apos;t added this account to TradeLoop yet.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("manualExisting")}
                  disabled={untrackedAccounts.length === 0}
                  className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Link2 className="size-4.5" /></span>
                  <span className="font-semibold">Existing account</span>
                  <p className="text-sm text-muted-foreground">
                    {untrackedAccounts.length === 0
                      ? "No untracked accounts to attach — all yours are already tracked."
                      : "Attach rules to an account already in TradeLoop (e.g. synced but unmatched)."}
                  </p>
                </button>
              </div>
            </>
          )}

          {step === "manualExisting" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("manualTarget")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Track prop firm account</p>
                <DialogTitle>Choose an account</DialogTitle>
                <DialogDescription>Pick the account to attach rules to, then enter the firm&apos;s evaluation rules.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>Account</Label>
                <Select value={existingAccountId != null ? String(existingAccountId) : ""} onValueChange={(v) => setExistingAccountId(v ? Number(v) : null)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose an account…" /></SelectTrigger>
                  <SelectContent>
                    {untrackedAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedExistingAccount && <RulesForm account={selectedExistingAccount} onDone={close} />}
            </>
          )}

          {step === "firm" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep(method === "manual" ? "manualTarget" : "method")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Track prop firm account</p>
                <DialogTitle>Choose your prop firm</DialogTitle>
              </DialogHeader>
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Start typing the firm name"
                  className="pl-9"
                  autoFocus
                />
              </div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Popular prop firms</p>
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {matchingFirms.map((firm) => (
                  <button
                    key={firm}
                    type="button"
                    onClick={() => pickFirm(firm)}
                    className="flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", chipColor(firm))}>
                      {initials(firm)}
                    </span>
                    <span className="truncate text-sm font-medium">{firm}</span>
                  </button>
                ))}
                {matchingFirms.length === 0 && search.trim() && (
                  <button
                    type="button"
                    onClick={() => pickFirm(search.trim())}
                    className="col-span-2 flex items-center gap-2.5 rounded-lg border border-dashed p-2.5 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", chipColor(search))}>
                      {initials(search) || "?"}
                    </span>
                    <span className="truncate text-sm font-medium">Use &quot;{search.trim()}&quot;</span>
                  </button>
                )}
              </div>
            </>
          )}

          {step === "manualPlan" && selectedFirm && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("firm")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Track prop firm account</p>
                <DialogTitle>Choose your plan</DialogTitle>
                <DialogDescription>Every {selectedFirm} plan we&apos;ve researched — pick the one you&apos;re on.</DialogDescription>
              </DialogHeader>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {programsForFirm.map((preset) => (
                  <button
                    key={preset.program}
                    type="button"
                    onClick={() => {
                      setSelectedPreset(preset)
                      setStep("manualDetails")
                    }}
                    className="w-full space-y-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="text-sm font-semibold">{preset.program}</span>
                    <PresetChips preset={preset} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPreset(null)
                    setStep("manualDetails")
                  }}
                  className="w-full rounded-lg border border-dashed p-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/40"
                >
                  None of these — I&apos;ll enter my own rules
                </button>
              </div>
            </>
          )}

          {step === "manualDetails" && selectedFirm && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep(programsForFirm.length > 0 ? "manualPlan" : "firm")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Track prop firm account</p>
                <DialogTitle>Account details</DialogTitle>
              </DialogHeader>
              <ManualDetailsForm firm={selectedFirm} preset={selectedPreset} onDone={close} />
            </>
          )}

          {step === "sync" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("firm")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Add trades</p>
                <DialogTitle>How do you want to sync it?</DialogTitle>
                {selectedFirm && <DialogDescription>You&apos;re linking <strong>{selectedFirm}</strong></DialogDescription>}
              </DialogHeader>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setStep("connect")}
                  className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><Wifi className="size-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Rithmic auto-sync</span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                        <Star className="size-2.5 fill-current" /> Recommended
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">Live sync — auto-imports every trade and balance update.</p>
                  </div>
                </button>
                <div className="flex items-center gap-3 rounded-xl border p-4 opacity-60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Clock className="size-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Tradovate</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Coming soon</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Live sync for Tradovate accounts.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === "connect" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("sync")} />
                <DialogTitle>Connect Rithmic</DialogTitle>
                <DialogDescription>Use your Rithmic trading login. Every account found under it is added and synced.</DialogDescription>
              </DialogHeader>
              {isPro ? (
                <ConnectForm onDone={() => setStep("success")} initialFirmHint={selectedFirm ?? undefined} />
              ) : (
                <>
                  <LiveSyncUpgradeBanner
                    title="Rithmic Connection"
                    description="Connect your prop firm and every trade lands in your journal automatically — no CSV needed. Rithmic sync is included with Pro."
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setMethod("manual")
                      pickFirm(selectedFirm ?? "")
                    }}
                  >
                    Continue without live sync
                  </Button>
                </>
              )}
            </>
          )}

          {step === "success" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-[var(--gain)]" /> Connected
                </DialogTitle>
                <DialogDescription>
                  We found and linked your Rithmic account(s), and auto-attached {selectedFirm ?? "your firm"}&apos;s rules where we could
                  match them. Open the Accounts tab to verify — auto-detected accounts are flagged for a quick check.
                </DialogDescription>
              </DialogHeader>
              <Button className="w-full" onClick={close}>Done</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
