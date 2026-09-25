"use client"

import { useState, useTransition } from "react"
import type React from "react"
import type { PropFirmAccount } from "@/app/actions/propfirm"
import { createManualPropFirmAccount } from "@/app/actions/propfirm"
import { PROP_FIRM_NAMES, getPresetPrograms, presetSizes, resolvePresetRules, type PropFirmPreset } from "@/lib/propfirm-presets"
import { formatCurrency } from "@/lib/calc"
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
import { useT } from "@/components/locale-provider"

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
  const t = useT()
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" /> {t("Back")}
    </button>
  )
}

const money = (n: number) => formatCurrency(n).replace(/\.00$/, "")

// The plan's thresholds for one account size (the $50K figures until a size
// is picked), in the dollars the firm publishes; percentages only for a
// plan whose figures we only know as percentages.
function PresetChips({ preset, size, phase = "evaluation" }: { preset: PropFirmPreset; size?: number; phase?: string }) {
  const t = useT()
  const sized = preset.sizes != null
  const r = resolvePresetRules(preset, size && size > 0 ? size : 50_000, phase)
  const dd = r.drawdownType === "trailing" ? t("Trailing DD") : t("Static DD")
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {r.profitTargetAmount != null && (
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t("Target")} {sized ? money(r.profitTargetAmount) : `${r.profitTargetPct}%`}</span>
      )}
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{dd} {sized ? money(r.maxDrawdownAmount) : `${r.maxDrawdownPct}%`}</span>
      {r.dailyLossLimitPct != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t("Daily loss")} {sized ? money(r.dailyLossLimitAmount!) : `${r.dailyLossLimitPct}%`}</span>}
      {r.minTradingDays != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t("{n}+ days", { n: r.minTradingDays })}</span>}
      {r.consistencyPct != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t("{pct}% consistency", { pct: r.consistencyPct })}</span>}
      {r.minPayoutDays != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t("Payout after {n} days", { n: r.minPayoutDays })}</span>}
      {r.payoutCap != null && <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{t("Payout cap")} {money(r.payoutCap)}</span>}
      {sized && !size && <span className="rounded-full px-2 py-0.5 text-muted-foreground">{t("on $50K")}</span>}
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
  const t = useT()
  const [name, setName] = useState("")
  const [startingBalance, setStartingBalance] = useState("")
  const [currentBalance, setCurrentBalance] = useState("")
  const [phase, setPhase] = useState("evaluation")
  // Custom-firm rules, in dollars (a preset's rules are resolved from the
  // size and phase on submit instead).
  const [profitTargetAmount, setProfitTargetAmount] = useState("")
  const [maxDrawdownAmount, setMaxDrawdownAmount] = useState("")
  const [drawdownType, setDrawdownType] = useState<"trailing" | "static">("trailing")
  const [dailyLossLimitAmount, setDailyLossLimitAmount] = useState("")
  const [minTradingDays, setMinTradingDays] = useState("")
  const [consistencyPct, setConsistencyPct] = useState("")
  const [pending, startTransition] = useTransition()
  const sizes = preset ? presetSizes(preset) : []
  const sizeNumber = Number(startingBalance) || 0
  const funded = phase === "funded"

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("firmName", firm)
    formData.set("planType", preset?.program ?? "")
    formData.set("name", name)
    formData.set("phase", phase)
    formData.set("startingBalance", startingBalance)
    formData.set("currentBalance", currentBalance)
    if (preset) {
      const r = resolvePresetRules(preset, sizeNumber, phase)
      formData.set("profitTargetAmount", r.profitTargetAmount?.toString() ?? "")
      formData.set("maxDrawdownAmount", r.maxDrawdownAmount.toString())
      formData.set("drawdownType", r.drawdownType)
      formData.set("dailyLossLimitAmount", r.dailyLossLimitAmount?.toString() ?? "")
      formData.set("minTradingDays", r.minTradingDays?.toString() ?? "")
      formData.set("consistencyPct", r.consistencyPct?.toString() ?? "")
      formData.set("minPayoutDays", r.minPayoutDays?.toString() ?? "")
      formData.set("minDayProfit", r.minDayProfit?.toString() ?? "")
      formData.set("payoutCap", r.payoutCap?.toString() ?? "")
    } else {
      formData.set("profitTargetAmount", funded ? "" : profitTargetAmount)
      formData.set("maxDrawdownAmount", maxDrawdownAmount)
      formData.set("drawdownType", drawdownType)
      formData.set("dailyLossLimitAmount", dailyLossLimitAmount)
      formData.set("minTradingDays", funded ? "" : minTradingDays)
      formData.set("consistencyPct", consistencyPct)
    }
    startTransition(async () => {
      try {
        const result = await createManualPropFirmAccount(formData)
        if (!result.ok) {
          toast.error(t(result.error))
          return
        }
        toast.success(t("Tracking started"))
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not create this account"))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {preset ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">{firm} — {t(preset.program)}{funded ? ` · ${t("funded")}` : ""}</p>
          {sizes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStartingBalance(String(s))}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-accent/40",
                    sizeNumber === s && "border-primary bg-primary/10 text-primary",
                  )}
                >
                  ${s / 1000}K
                </button>
              ))}
            </div>
          )}
          <PresetChips preset={preset} size={sizeNumber || undefined} phase={phase} />
          {sizes.length > 0 && sizeNumber > 0 && !sizes.includes(sizeNumber) && (
            <p className="text-xs text-[var(--chart-4)]">{t("{firm} doesn't list a ${size} account — these are the $50K figures scaled, so check them.", { firm, size: sizeNumber.toLocaleString() })}</p>
          )}
          <p className="text-xs text-muted-foreground">{t(preset.notes)}</p>
        </div>
      ) : (
        <>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("We don't have {firm} in our presets yet — enter its rules yourself, in dollars, the way the firm publishes them.", { firm })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {!funded && (
              <div className="space-y-1.5">
                <Label htmlFor="profitTargetAmount">{t("Profit target ($)")}</Label>
                <Input id="profitTargetAmount" type="number" step="any" placeholder={t("Leave blank if none")} value={profitTargetAmount} onChange={(e) => setProfitTargetAmount(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="maxDrawdownAmount">{t("Max drawdown ($)")}</Label>
              <Input id="maxDrawdownAmount" type="number" step="any" required value={maxDrawdownAmount} onChange={(e) => setMaxDrawdownAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("Drawdown type")}</Label>
              <Select value={drawdownType} onValueChange={(v) => v && setDrawdownType(v as "trailing" | "static")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trailing">{t("Trailing (from peak)")}</SelectItem>
                  <SelectItem value="static">{t("Static (from starting)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dailyLossLimitAmount">{t("Daily loss limit ($)")}</Label>
              <Input id="dailyLossLimitAmount" type="number" step="any" placeholder={t("Leave blank if none")} value={dailyLossLimitAmount} onChange={(e) => setDailyLossLimitAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!funded && (
              <div className="space-y-1.5">
                <Label htmlFor="minTradingDays">{t("Min trading days")}</Label>
                <Input id="minTradingDays" type="number" placeholder={t("Leave blank if none")} value={minTradingDays} onChange={(e) => setMinTradingDays(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="consistencyPct">{t("Consistency rule (%)")}</Label>
              <Input id="consistencyPct" type="number" step="any" placeholder={t("Leave blank if none")} value={consistencyPct} onChange={(e) => setConsistencyPct(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="pf-name">{t("Account nickname (optional)")}</Label>
        <Input id="pf-name" placeholder={t("e.g. {example}", { example: `${firm}${preset ? ` ${preset.program}` : ""}` })} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="startingBalance">{t("Account size ($)")}</Label>
          <Input id="startingBalance" type="number" step="any" required placeholder="50000" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currentBalance">{t("Current balance")}</Label>
          <Input id="currentBalance" type="number" step="any" placeholder={t("Same as size if just started")} value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("If you've already been trading this account elsewhere, enter where it stands today so progress and drawdown start from the right place.")}
      </p>

      <div className="space-y-1.5">
        <Label>{t("Current situation")}</Label>
        <Select value={phase} onValueChange={(v) => v && setPhase(v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="evaluation">{t("Evaluation")}</SelectItem>
            <SelectItem value="verification">{t("Verification")}</SelectItem>
            <SelectItem value="funded">{t("Funded")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t("Starting…") : t("Start tracking")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function TrackPropFirmWizard({ accounts, isPro }: { accounts: PropFirmAccount[]; isPro: boolean }) {
  const t = useT()
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
      <DialogTrigger render={<Button size="sm"><Plus className="size-4" /> {t("Track prop firm account")}</Button>} />
      <DialogContent className="sm:max-w-lg">
        <div className="space-y-4">
          <ProgressBar step={step} method={method} />

          {step === "method" && (
            <>
              <DialogHeader>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Track prop firm account")}</p>
                <DialogTitle>{t("How do you want to add it?")}</DialogTitle>
              </DialogHeader>
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                <Info className="mt-0.5 size-4 shrink-0" />
                {t("Automatic connect currently supports the Rithmic data feed only.")}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setMethod("auto")
                    setStep("firm")
                  }}
                  className="flex flex-col items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-4 text-start transition-colors hover:bg-primary/10"
                >
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                    <Star className="size-2.5 fill-current" /> {t("Recommended")}
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><RefreshCw className="size-4.5" /></span>
                  <span className="font-semibold">{t("Automatic connect")}</span>
                  <p className="text-sm text-muted-foreground">{t("Link your broker login — trades and balance sync in automatically.")}</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMethod("manual")
                    setStep("manualTarget")
                  }}
                  className="flex flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors hover:bg-accent/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><PenLine className="size-4.5" /></span>
                  <span className="font-semibold">{t("Manual entry")}</span>
                  <p className="text-sm text-muted-foreground">{t("We'll walk you through the firm, plan, and account details.")}</p>
                </button>
              </div>
            </>
          )}

          {step === "manualTarget" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("method")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Track prop firm account")}</p>
                <DialogTitle>{t("New account or an existing one?")}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setStep("firm")}
                  className="flex flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors hover:bg-accent/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FilePlus2 className="size-4.5" /></span>
                  <span className="font-semibold">{t("New account")}</span>
                  <p className="text-sm text-muted-foreground">{t("You haven't added this account to TradeLoop yet.")}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("manualExisting")}
                  disabled={untrackedAccounts.length === 0}
                  className="flex flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Link2 className="size-4.5" /></span>
                  <span className="font-semibold">{t("Existing account")}</span>
                  <p className="text-sm text-muted-foreground">
                    {untrackedAccounts.length === 0
                      ? t("No untracked accounts to attach — all yours are already tracked.")
                      : t("Attach rules to an account already in TradeLoop (e.g. synced but unmatched).")}
                  </p>
                </button>
              </div>
            </>
          )}

          {step === "manualExisting" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("manualTarget")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Track prop firm account")}</p>
                <DialogTitle>{t("Choose an account")}</DialogTitle>
                <DialogDescription>{t("Pick the account to attach rules to, then enter the firm's evaluation rules.")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>{t("Account")}</Label>
                <Select value={existingAccountId != null ? String(existingAccountId) : ""} onValueChange={(v) => setExistingAccountId(v ? Number(v) : null)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={t("Choose an account…")} /></SelectTrigger>
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
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Track prop firm account")}</p>
                <DialogTitle>{t("Choose your prop firm")}</DialogTitle>
              </DialogHeader>
              <div className="relative">
                <Search className="absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("Start typing the firm name")}
                  className="ps-9"
                  autoFocus
                />
              </div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("Popular prop firms")}</p>
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pe-1">
                {matchingFirms.map((firm) => (
                  <button
                    key={firm}
                    type="button"
                    onClick={() => pickFirm(firm)}
                    className="flex items-center gap-2.5 rounded-lg border p-2.5 text-start transition-colors hover:bg-accent/40"
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
                    className="col-span-2 flex items-center gap-2.5 rounded-lg border border-dashed p-2.5 text-start transition-colors hover:bg-accent/40"
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", chipColor(search))}>
                      {initials(search) || "?"}
                    </span>
                    <span className="truncate text-sm font-medium">{t("Use “{name}”", { name: search.trim() })}</span>
                  </button>
                )}
              </div>
            </>
          )}

          {step === "manualPlan" && selectedFirm && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("firm")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Track prop firm account")}</p>
                <DialogTitle>{t("Choose your plan")}</DialogTitle>
                <DialogDescription>{t("Every {firm} plan we've researched — pick the one you're on.", { firm: selectedFirm })}</DialogDescription>
              </DialogHeader>
              <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
                {programsForFirm.map((preset) => (
                  <button
                    key={preset.program}
                    type="button"
                    onClick={() => {
                      setSelectedPreset(preset)
                      setStep("manualDetails")
                    }}
                    className="w-full space-y-1.5 rounded-lg border p-3 text-start transition-colors hover:bg-accent/40"
                  >
                    <span className="text-sm font-semibold">{t(preset.program)}</span>
                    <PresetChips preset={preset} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPreset(null)
                    setStep("manualDetails")
                  }}
                  className="w-full rounded-lg border border-dashed p-3 text-start text-sm text-muted-foreground transition-colors hover:bg-accent/40"
                >
                  {t("None of these — I'll enter my own rules")}
                </button>
              </div>
            </>
          )}

          {step === "manualDetails" && selectedFirm && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep(programsForFirm.length > 0 ? "manualPlan" : "firm")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Track prop firm account")}</p>
                <DialogTitle>{t("Account details")}</DialogTitle>
              </DialogHeader>
              <ManualDetailsForm firm={selectedFirm} preset={selectedPreset} onDone={close} />
            </>
          )}

          {step === "sync" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("firm")} />
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("Add trades")}</p>
                <DialogTitle>{t("How do you want to sync it?")}</DialogTitle>
                {selectedFirm && <DialogDescription>{t("You're linking")} <strong>{selectedFirm}</strong></DialogDescription>}
              </DialogHeader>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setStep("connect")}
                  className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-start transition-colors hover:bg-primary/10"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><Wifi className="size-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t("Rithmic auto-sync")}</span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                        <Star className="size-2.5 fill-current" /> {t("Recommended")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t("Live sync — auto-imports every trade and balance update.")}</p>
                  </div>
                </button>
                <div className="flex items-center gap-3 rounded-xl border p-4 opacity-60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Clock className="size-4.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Tradovate</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("Coming soon")}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t("Live sync for Tradovate accounts.")}</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === "connect" && (
            <>
              <DialogHeader>
                <BackButton onClick={() => setStep("sync")} />
                <DialogTitle>{t("Connect Rithmic")}</DialogTitle>
                <DialogDescription>{t("Use your Rithmic trading login. Every account found under it is added and synced.")}</DialogDescription>
              </DialogHeader>
              {isPro ? (
                <ConnectForm onDone={() => setStep("success")} initialFirmHint={selectedFirm ?? undefined} />
              ) : (
                <>
                  <LiveSyncUpgradeBanner
                    title={t("Rithmic Connection")}
                    description={t("Connect your prop firm and every trade lands in your journal automatically — no CSV needed. Rithmic sync is included with Pro.")}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setMethod("manual")
                      pickFirm(selectedFirm ?? "")
                    }}
                  >
                    {t("Continue without live sync")}
                  </Button>
                </>
              )}
            </>
          )}

          {step === "success" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-[var(--gain)]" /> {t("Connected")}
                </DialogTitle>
                <DialogDescription>
                  {t("We found and linked your Rithmic account(s), and auto-attached {firm}'s rules where we could match them. Open the Accounts tab to verify — auto-detected accounts are flagged for a quick check.", { firm: selectedFirm ?? t("your firm") })}
                </DialogDescription>
              </DialogHeader>
              <Button className="w-full" onClick={close}>{t("Done")}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
