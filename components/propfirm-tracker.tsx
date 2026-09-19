"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import {
  savePropFirmRules,
  deletePropFirmRules,
  setBreachReason,
  logPropFirmTransaction,
  type PropFirmAccount,
} from "@/app/actions/propfirm"
import { formatCurrency } from "@/lib/calc"
import { phaseFromAccountName } from "@/lib/broker-balance"
import { cn } from "@/lib/utils"
import { PROP_FIRM_NAMES, getPresetPrograms, presetSizes, resolvePresetRules, type PropFirmPreset } from "@/lib/propfirm-presets"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Settings2,
  Trash2,
  Info,
  Receipt,
  Sparkles,
  MoreHorizontal,
  Target,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  List,
  LayoutGrid,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { useIntlLocale, useT } from "@/components/locale-provider"
import type { TFunction } from "@/lib/i18n"

function fmtAgo(iso: string, t: TFunction): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return t("just now")
  if (mins < 60) return t("{n}m ago", { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 48) return t("{n}h ago", { n: hours })
  return t("{n}d ago", { n: Math.round(hours / 24) })
}

const CUSTOM = "__custom__"

const BREACH_REASONS = [
  "Overtrading",
  "Revenge trading",
  "Held through news",
  "Oversized position",
  "No stop-loss",
  "FOMO entry",
  "Ignored trading plan",
  "Technical/platform issue",
  "Other",
]

function Bar({ pct, tone }: { pct: number; tone: "gain" | "loss" }) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", tone === "gain" ? "bg-[var(--gain)]" : "bg-[var(--loss)]")}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

const STATUS_META = {
  active: { label: "Active", icon: ShieldQuestion, className: "border-primary/30 text-primary" },
  passed: { label: "Passed", icon: ShieldCheck, className: "border-[var(--gain)]/30 text-[var(--gain)]" },
  breached: { label: "Breached", icon: ShieldAlert, className: "border-[var(--loss)]/30 text-[var(--loss)]" },
}

// Rule thresholds are entered in dollars — the unit firms publish them in —
// with the percentage of the account size shown alongside. Picking a plan
// fills them in for this account's size and phase from the preset, and
// changing the phase or size re-fills them while a plan is selected.
export function RulesForm({ account, onDone }: { account: PropFirmAccount; onDone: () => void }) {
  const initialFirm = account.firmName && PROP_FIRM_NAMES.includes(account.firmName) ? account.firmName : CUSTOM
  const rules = account.rules
  const size0 = account.startingBalance
  const fromPct = (pct: number | null | undefined) => (pct != null && size0 > 0 ? Math.round(size0 * pct) / 100 : null)
  const [firm, setFirm] = useState<string>(initialFirm)
  const [program, setProgram] = useState<string>(account.planType ?? "")
  const [customFirmName, setCustomFirmName] = useState(initialFirm === CUSTOM ? (account.firmName ?? "") : "")
  // A synced account that has no rules yet is labelled by its firm —
  // "PA-…", "…FUNDED…" — so the form opens on the right stage.
  const [phase, setPhase] = useState(rules?.phase ?? phaseFromAccountName(account.name))
  const [size, setSize] = useState(size0 > 0 ? String(size0) : "")
  const [profitTargetAmount, setProfitTargetAmount] = useState((rules?.profitTargetAmount ?? fromPct(rules?.profitTargetPct))?.toString() ?? "")
  const [maxDrawdownAmount, setMaxDrawdownAmount] = useState((rules?.maxDrawdownAmount ?? fromPct(rules?.maxDrawdownPct))?.toString() ?? "")
  const [drawdownType, setDrawdownType] = useState(rules?.drawdownType ?? "trailing")
  const [dailyLossLimitAmount, setDailyLossLimitAmount] = useState((rules?.dailyLossLimitAmount ?? fromPct(rules?.dailyLossLimitPct))?.toString() ?? "")
  const [minTradingDays, setMinTradingDays] = useState(rules?.minTradingDays?.toString() ?? "")
  const [consistencyPct, setConsistencyPct] = useState(rules?.consistencyPct?.toString() ?? "")
  const [minPayoutDays, setMinPayoutDays] = useState(rules?.minPayoutDays?.toString() ?? "")
  const [minDayProfit, setMinDayProfit] = useState(rules?.minDayProfit?.toString() ?? "")
  const [payoutCap, setPayoutCap] = useState(rules?.payoutCap?.toString() ?? "")
  const [pending, startTransition] = useTransition()
  const t = useT()

  const programs = firm !== CUSTOM ? getPresetPrograms(firm) : []
  const activePreset: PropFirmPreset | undefined = programs.find((p) => p.program === program)
  const sizeNumber = Number(size) || 0
  const funded = phase === "funded"
  const pctLabel = (amount: string) => {
    const n = Number(amount)
    return sizeNumber > 0 && n > 0 ? t("{pct}% of account", { pct: (Math.round((n / sizeNumber) * 10000) / 100).toString() }) : null
  }

  function applyPreset(preset: PropFirmPreset, forSize: number, forPhase: string) {
    const r = resolvePresetRules(preset, forSize, forPhase)
    setProfitTargetAmount(r.profitTargetAmount?.toString() ?? "")
    setMaxDrawdownAmount(r.maxDrawdownAmount.toString())
    setDrawdownType(r.drawdownType)
    setDailyLossLimitAmount(r.dailyLossLimitAmount?.toString() ?? "")
    setMinTradingDays(r.minTradingDays?.toString() ?? "")
    setConsistencyPct(r.consistencyPct?.toString() ?? "")
    setMinPayoutDays(r.minPayoutDays?.toString() ?? "")
    setMinDayProfit(r.minDayProfit?.toString() ?? "")
    setPayoutCap(r.payoutCap?.toString() ?? "")
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("firmName", firm === CUSTOM ? customFirmName : firm)
    formData.set("planType", firm === CUSTOM ? "" : program)
    formData.set("phase", phase)
    formData.set("startingBalance", size)
    formData.set("profitTargetAmount", funded ? "" : profitTargetAmount)
    formData.set("maxDrawdownAmount", maxDrawdownAmount)
    formData.set("drawdownType", drawdownType)
    formData.set("dailyLossLimitAmount", dailyLossLimitAmount)
    formData.set("minTradingDays", funded ? "" : minTradingDays)
    formData.set("consistencyPct", consistencyPct)
    formData.set("minPayoutDays", funded ? minPayoutDays : "")
    formData.set("minDayProfit", funded ? minDayProfit : "")
    formData.set("payoutCap", funded ? payoutCap : "")
    startTransition(async () => {
      try {
        await savePropFirmRules(account.id, formData)
        toast.success(t("Rules saved"))
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not save rules"))
      }
    })
  }

  const sizes = activePreset ? presetSizes(activePreset) : []

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("Prop firm")}</Label>
          <Select
            value={firm}
            onValueChange={(v) => {
              if (!v) return
              setFirm(v)
              setProgram("")
            }}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROP_FIRM_NAMES.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
              <SelectItem value={CUSTOM}>{t("Custom / other firm")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("Account type")}</Label>
          <Select
            value={program}
            onValueChange={(v) => {
              if (!v) return
              setProgram(v)
              const preset = programs.find((p) => p.program === v)
              if (preset) applyPreset(preset, sizeNumber, phase)
            }}
            disabled={firm === CUSTOM}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder={firm === CUSTOM ? "—" : t("Select…")} /></SelectTrigger>
            <SelectContent>
              {programs.map((p) => (
                <SelectItem key={p.program} value={p.program}>{t(p.program)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {firm === CUSTOM && (
        <div className="space-y-1.5">
          <Label htmlFor="customFirmName">{t("Firm name")}</Label>
          <Input
            id="customFirmName"
            placeholder={t("e.g. My Prop Firm")}
            value={customFirmName}
            onChange={(e) => setCustomFirmName(e.target.value)}
          />
        </div>
      )}

      {activePreset && (
        <p className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t(activePreset.notes)} {t("Fields below are pre-filled but editable — always verify against your firm's current rulebook.")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("Phase")}</Label>
          <Select
            value={phase}
            onValueChange={(v) => {
              if (!v) return
              setPhase(v)
              if (activePreset) applyPreset(activePreset, sizeNumber, v)
            }}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="evaluation">{t("Evaluation")}</SelectItem>
              <SelectItem value="verification">{t("Verification")}</SelectItem>
              <SelectItem value="funded">{t("Funded")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rules-size">{t("Account size ($)")}</Label>
          <Input
            id="rules-size"
            type="number"
            step="any"
            min="0"
            placeholder="50000"
            value={size}
            onChange={(e) => {
              setSize(e.target.value)
              const n = Number(e.target.value)
              if (activePreset && n > 0) applyPreset(activePreset, n, phase)
            }}
          />
        </div>
      </div>
      {sizes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sizes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSize(String(s))
                if (activePreset) applyPreset(activePreset, s, phase)
              }}
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
      {size0 <= 0 && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--chart-4)]">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("This account has no size yet, so every threshold below reads as $0 until you set one.")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {!funded && (
          <div className="space-y-1.5">
            <Label htmlFor="profitTargetAmount">{t("Profit target ($)")}</Label>
            <Input
              id="profitTargetAmount"
              type="number"
              step="any"
              placeholder={t("Leave blank if none")}
              value={profitTargetAmount}
              onChange={(e) => setProfitTargetAmount(e.target.value)}
            />
            {pctLabel(profitTargetAmount) && <p className="text-[11px] text-muted-foreground">{pctLabel(profitTargetAmount)}</p>}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="maxDrawdownAmount">{t("Max drawdown ($)")}</Label>
          <Input
            id="maxDrawdownAmount"
            type="number"
            step="any"
            required
            value={maxDrawdownAmount}
            onChange={(e) => setMaxDrawdownAmount(e.target.value)}
          />
          {pctLabel(maxDrawdownAmount) && <p className="text-[11px] text-muted-foreground">{pctLabel(maxDrawdownAmount)}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("Drawdown type")}</Label>
          <Select value={drawdownType} onValueChange={(v) => v && setDrawdownType(v as "trailing" | "static")}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="trailing">{t("Trailing (from peak balance)")}</SelectItem>
              <SelectItem value="static">{t("Static (from starting balance)")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dailyLossLimitAmount">{t("Daily loss limit ($)")}</Label>
          <Input
            id="dailyLossLimitAmount"
            type="number"
            step="any"
            placeholder={t("Leave blank if none")}
            value={dailyLossLimitAmount}
            onChange={(e) => setDailyLossLimitAmount(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {!funded && (
          <div className="space-y-1.5">
            <Label htmlFor="minTradingDays">{t("Min trading days")}</Label>
            <Input
              id="minTradingDays"
              type="number"
              placeholder={t("Leave blank if none")}
              value={minTradingDays}
              onChange={(e) => setMinTradingDays(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="consistencyPct">{t("Consistency rule (%)")}</Label>
          <Input
            id="consistencyPct"
            type="number"
            step="any"
            placeholder={t("Leave blank if none")}
            value={consistencyPct}
            onChange={(e) => setConsistencyPct(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">{funded ? t("Best day may be at most this share of profit since the last payout.") : t("Best day may be at most this share of total profit.")}</p>
        </div>
      </div>

      {funded && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium">{t("Payout rules")}</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="minPayoutDays">{t("Qualifying days")}</Label>
              <Input id="minPayoutDays" type="number" placeholder={t("e.g. 3")} value={minPayoutDays} onChange={(e) => setMinPayoutDays(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minDayProfit">{t("Day counts at ($)")}</Label>
              <Input id="minDayProfit" type="number" step="any" placeholder={t("e.g. 200")} value={minDayProfit} onChange={(e) => setMinDayProfit(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payoutCap">{t("Max per payout ($)")}</Label>
              <Input id="payoutCap" type="number" step="any" placeholder={t("No cap")} value={payoutCap} onChange={(e) => setPayoutCap(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("Payout progress counts from the last payout you logged on this account.")}</p>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("Presets are researched, not official — double check against your firm's current rules before relying on this.")}
      </p>

      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t("Saving…") : t("Save rules")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function LogTransactionForm({ account, onDone }: { account: PropFirmAccount; onDone: () => void }) {
  const t = useT()
  const [type, setType] = useState<"cost" | "payout">("cost")
  const [category, setCategory] = useState("evaluation_fee")
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("type", type)
    if (type === "cost") formData.set("category", category)
    startTransition(async () => {
      try {
        await logPropFirmTransaction(account.id, formData)
        toast.success(t("Logged"))
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not log transaction"))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("Type")}</Label>
          <Select value={type} onValueChange={(v) => v && setType(v as "cost" | "payout")}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cost">{t("Cost (fee / reset)")}</SelectItem>
              <SelectItem value="payout">{t("Payout received")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {type === "cost" ? (
          <div className="space-y-1.5">
            <Label>{t("Category")}</Label>
            <Select value={category} onValueChange={(v) => v && setCategory(v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="evaluation_fee">{t("Evaluation fee")}</SelectItem>
                <SelectItem value="reset_fee">{t("Reset fee")}</SelectItem>
                <SelectItem value="activation_fee">{t("Activation fee")}</SelectItem>
                <SelectItem value="other">{t("Other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="occurredAt">{t("Date")}</Label>
            <Input id="occurredAt" name="occurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
        )}
      </div>
      {type === "cost" && (
        <div className="space-y-1.5">
          <Label htmlFor="occurredAt">{t("Date")}</Label>
          <Input id="occurredAt" name="occurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="amount">{t("Amount")}</Label>
        <Input id="amount" name="amount" type="number" step="0.01" required placeholder="0.00" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note">{t("Note (optional)")}</Label>
        <Input id="note" name="note" placeholder={t("e.g. 50K reset after breach")} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t("Saving…") : t("Log it")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AccountCard({ account }: { account: PropFirmAccount }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [open, setOpen] = useState(false)
  const [txOpen, setTxOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onRemoveRules() {
    startTransition(async () => {
      try {
        await deletePropFirmRules(account.id)
        toast.success(t("Rules removed"))
      } catch {
        toast.error(t("Could not remove rules"))
      }
    })
  }

  function onSetBreachReason(reason: string) {
    startTransition(async () => {
      try {
        await setBreachReason(account.id, reason === "" ? null : reason)
        toast.success(t("Saved"))
      } catch {
        toast.error(t("Could not save reason"))
      }
    })
  }

  if (!account.rules || !account.evaluation) return null

  const { evaluation, rules } = account
  const meta = STATUS_META[evaluation.status]
  const StatusIcon = meta.icon
  const stepLabel = rules.phase === "evaluation" ? t("Step 1") : rules.phase === "verification" ? t("Step 2") : t("Funded")

  const drawdownPct = evaluation.drawdownLimitAmount > 0 ? (evaluation.currentDrawdownAmount / evaluation.drawdownLimitAmount) * 100 : 0
  const dailyLossPct = evaluation.dailyLossLimitAmount ? (evaluation.worstDayLossAmount / evaluation.dailyLossLimitAmount) * 100 : 0
  const ddReference = rules.drawdownType === "trailing" ? evaluation.peakBalance : account.startingBalance
  const floor = ddReference - evaluation.drawdownLimitAmount
  const funded = rules.phase === "funded"
  const consistencyPct = evaluation.consistencySharePct
  const consistencyBar = rules.consistencyPct != null && consistencyPct != null ? (consistencyPct / rules.consistencyPct) * 100 : 0
  const payoutDaysBar = rules.minPayoutDays ? (evaluation.qualifyingDays / rules.minPayoutDays) * 100 : evaluation.cycleNetProfit > 0 ? 100 : 0
  const pct = (amount: number | null) =>
    amount != null && account.startingBalance > 0 ? ` (${Math.round((amount / account.startingBalance) * 10000) / 100}%)` : ""

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/accounts/${account.id}`} className="text-lg font-semibold hover:underline">{account.name}</Link>
          <span className="text-xs font-medium text-muted-foreground uppercase">{stepLabel}</span>
          <Badge variant="outline" className={cn("uppercase", meta.className)}>
            <StatusIcon className="size-3.5" /> {t(meta.label)}
          </Badge>
          {account.autoDetected && (
            <Badge variant="outline" className="border-primary/30 text-primary uppercase">
              <Sparkles className="size-3.5" /> {t("Verify")}
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={t("Account actions")}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTxOpen(true)}>
              <Receipt className="size-4" /> {t("Log fee/payout")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOpen(true)}>
              <Settings2 className="size-4" /> {t("Edit rules")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onRemoveRules} disabled={pending}>
              <Trash2 className="size-4" /> {t("Stop tracking")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">{t("Balance:")}</span>{" "}
          <span className="font-semibold tabular-nums">{formatCurrency(evaluation.currentBalance, account.currency)}</span>{" "}
          <span className={cn("font-medium tabular-nums", evaluation.netProfit >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
            ({evaluation.netProfit >= 0 ? "+" : ""}
            {formatCurrency(evaluation.netProfit, account.currency)})
          </span>
          {account.balanceUpdatedAt && (
            <span className="ms-1.5 text-xs text-muted-foreground" title={t("Balance as reported by Rithmic")}>
              · {t("from Rithmic {ago}", { ago: fmtAgo(account.balanceUpdatedAt, t) })}
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">{account.firmName ?? t("Firm not set")}</p>
      </div>
      {account.startingBalance <= 0 && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--chart-4)]/40 bg-[var(--chart-4)]/10 px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--chart-4)]" />
          <span>
            {t("This account has no size, so its limits read as $0.")}{" "}
            <button type="button" className="font-medium underline" onClick={() => setOpen(true)}>{t("Set the account size")}</button>
            {account.balanceUpdatedAt == null && " " + t("— or sync it from Rithmic and it's worked out from the balance.")}
          </span>
        </div>
      )}
      {account.startingBalance > 0 && account.startingBalanceInferred && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("Account size {size} was worked out from the Rithmic balance — the rules are sized to it.", { size: formatCurrency(account.startingBalance, account.currency).replace(/\.00$/, "") })}{" "}
            <button type="button" className="font-medium text-foreground underline" onClick={() => setOpen(true)}>{t("Not right? Correct it")}</button>
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
        <CalendarClock className="size-4 shrink-0" />
        <span>
          {rules.minTradingDays != null ? t("{days}/{needed} trading days", { days: evaluation.tradingDays, needed: rules.minTradingDays }) : t("No time limit")}
          {account.trackedSince && <> · {t("Started on {date}", { date: new Date(account.trackedSince).toLocaleDateString(dateLocale, { month: "short", day: "2-digit", year: "numeric" }) })}</>}
        </span>
      </div>

      <p className="text-sm">
        <span className="text-muted-foreground">{t("Account:")}</span> {account.name}
        {account.planType && <span className="text-muted-foreground"> · {t(account.planType)}</span>}
      </p>

      {evaluation.breachReason && (
        <div className="space-y-2 rounded-md border border-[var(--loss)]/30 bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">
          <p>
            {t(evaluation.breachReason)}
            {evaluation.breachedAt && <> — {new Date(evaluation.breachedAt).toLocaleDateString(dateLocale)}</>}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--loss)]/80">{t("What actually caused it?")}</span>
            <Select value={account.breachReasonTag ?? ""} onValueChange={(v) => v && onSetBreachReason(v)}>
              <SelectTrigger className="h-7 w-48 bg-background text-xs"><SelectValue placeholder={t("Tag a reason…")} /></SelectTrigger>
              <SelectContent>
                {BREACH_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{t(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-3 border-t pt-3">
        {evaluation.profitTargetAmount != null && (
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Target className="size-4" />
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">{t("Profit:")} {formatCurrency(evaluation.netProfit, account.currency)}</p>
              <p className="text-xs text-muted-foreground">{t("Target:")} {formatCurrency(evaluation.profitTargetAmount, account.currency)}{pct(evaluation.profitTargetAmount)}</p>
            </div>
            <div className="flex-1"><Bar pct={evaluation.profitProgressPct ?? 0} tone="gain" /></div>
            <span className="w-10 shrink-0 text-end text-sm font-medium tabular-nums">{Math.round(evaluation.profitProgressPct ?? 0)}%</span>
          </div>
        )}

        {evaluation.dailyLossLimitAmount != null && (
          <div className="flex items-center gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", dailyLossPct < 100 ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
              {dailyLossPct < 100 ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">{formatCurrency(evaluation.worstDayLossAmount, account.currency)}</p>
              <p className="text-xs text-muted-foreground">{t("Max daily loss:")} {formatCurrency(evaluation.dailyLossLimitAmount, account.currency)}</p>
            </div>
            <div className="flex-1"><Bar pct={dailyLossPct} tone="loss" /></div>
            <span className="w-10 shrink-0 text-end text-sm font-medium tabular-nums">{Math.round(dailyLossPct)}%</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", drawdownPct < 100 ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
            {drawdownPct < 100 ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
          </span>
          <div className="w-40 shrink-0">
            <p className="text-sm font-medium">{t("Drawdown:")} {formatCurrency(evaluation.currentDrawdownAmount, account.currency)}</p>
            <p className="text-xs text-muted-foreground">
              {t("Max:")} {formatCurrency(evaluation.drawdownLimitAmount, account.currency)}{pct(evaluation.drawdownLimitAmount)} · {t("Floor:")} {formatCurrency(floor, account.currency)}
            </p>
            {account.brokerDrawdownFloor != null && (
              <p className="text-xs text-muted-foreground" title={t("The liquidation threshold Rithmic's risk system reports for this account")}>
                {t("Rithmic floor:")} {formatCurrency(account.brokerDrawdownFloor, account.currency)}
              </p>
            )}
          </div>
          <div className="flex-1"><Bar pct={drawdownPct} tone="loss" /></div>
          <span className="w-10 shrink-0 text-end text-sm font-medium tabular-nums">{Math.round(drawdownPct)}%</span>
        </div>

        {rules.consistencyPct != null && (
          <div className="flex items-center gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", evaluation.consistencyMet ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
              {evaluation.consistencyMet ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">{t("Best day:")} {consistencyPct == null ? "—" : t("{pct}% of profit", { pct: Math.round(consistencyPct) })}</p>
              <p className="text-xs text-muted-foreground">{t("Consistency limit:")} {rules.consistencyPct}%{funded ? ` · ${t("since last payout")}` : ""}</p>
            </div>
            <div className="flex-1"><Bar pct={consistencyBar} tone="loss" /></div>
            <span className="w-10 shrink-0 text-end text-sm font-medium tabular-nums">{consistencyPct == null ? "—" : `${Math.round(consistencyPct)}%`}</span>
          </div>
        )}

        {funded && (
          <div className="flex items-center gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", evaluation.payoutEligible ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-muted text-muted-foreground")}>
              <Wallet className="size-4" />
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">
                {evaluation.payoutEligible ? t("Payout ready") : t("Next payout")}
                {evaluation.payoutAvailable != null && <>: {formatCurrency(evaluation.payoutAvailable, account.currency)}</>}
              </p>
              <p className="text-xs text-muted-foreground">
                {rules.minPayoutDays != null
                  ? `${t("{days}/{needed} qualifying days", { days: evaluation.qualifyingDays, needed: rules.minPayoutDays })}${rules.minDayProfit != null ? ` (${formatCurrency(rules.minDayProfit, account.currency)}+)` : ""}`
                  : t("{amount} since last payout", { amount: formatCurrency(evaluation.cycleNetProfit, account.currency) })}
                {rules.payoutCap != null && ` · ${t("cap {amount}", { amount: formatCurrency(rules.payoutCap, account.currency) })}`}
              </p>
            </div>
            <div className="flex-1"><Bar pct={payoutDaysBar} tone="gain" /></div>
            <span className="w-10 shrink-0 text-end text-sm font-medium tabular-nums">
              {rules.minPayoutDays != null ? `${evaluation.qualifyingDays}/${rules.minPayoutDays}` : evaluation.payoutEligible ? "✓" : "—"}
            </span>
          </div>
        )}

        {rules.minTradingDays != null && (
          <div className="flex items-center gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", evaluation.minTradingDaysMet ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-muted text-muted-foreground")}>
              <CheckCircle2 className="size-4" />
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">{t("Trading days")}</p>
              <p className="text-xs text-muted-foreground">{t("Minimum:")} {rules.minTradingDays}</p>
            </div>
            <div className="flex-1"><Bar pct={(evaluation.tradingDays / rules.minTradingDays) * 100} tone="gain" /></div>
            <span className="w-10 shrink-0 text-end text-sm font-medium tabular-nums">{evaluation.tradingDays}/{rules.minTradingDays}</span>
          </div>
        )}
      </div>

      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Log a fee or payout for {name}", { name: account.name })}</DialogTitle>
            <DialogDescription>{t("Powers the financial dashboard's spend/earn/ROI totals.")}</DialogDescription>
          </DialogHeader>
          <LogTransactionForm account={account} onDone={() => setTxOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Edit rules for {name}", { name: account.name })}</DialogTitle>
            <DialogDescription>{t("Update your firm's evaluation rules.")}</DialogDescription>
          </DialogHeader>
          <RulesForm account={account} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function AccountGroup({ accounts, view }: { accounts: PropFirmAccount[]; view: "list" | "grid" }) {
  const t = useT()
  if (accounts.length === 0) {
    return (
      <Card className="flex h-32 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">{t("Nothing in this group yet.")}</p>
      </Card>
    )
  }
  return (
    <div className={cn(view === "grid" ? "grid gap-4 lg:grid-cols-2" : "space-y-4")}>
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
    </div>
  )
}

export function PropFirmTracker({ accounts }: { accounts: PropFirmAccount[] }) {
  const t = useT()
  const [view, setView] = useState<"list" | "grid">("list")

  if (accounts.length === 0) {
    return (
      <Card className="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">
          {t("No prop firm accounts yet — use “Track prop firm account” above to add one.")}
        </p>
      </Card>
    )
  }

  const breached = accounts.filter((a) => a.evaluation!.status === "breached")
  const funded = accounts.filter((a) => a.rules!.phase === "funded" && a.evaluation!.status !== "breached")
  const evaluations = accounts.filter((a) => a.rules!.phase !== "funded" && a.evaluation!.status !== "breached")

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("Status is computed from your closed, synced trades — it can't see floating P&L on a position that's still open. Treat this as a tracker, not a final ruling; always confirm with your firm's own dashboard.")}
      </div>

      <Tabs defaultValue="evaluations">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="evaluations">{t("Evaluations ({n})", { n: evaluations.length })}</TabsTrigger>
            <TabsTrigger value="funded">{t("Funded ({n})", { n: funded.length })}</TabsTrigger>
            <TabsTrigger value="breached">{t("Breached ({n})", { n: breached.length })}</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label={t("List view")}
              className={cn("rounded-md p-1.5 transition-colors", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <List className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-label={t("Grid view")}
              className={cn("rounded-md p-1.5 transition-colors", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
        </div>
        <TabsContent value="evaluations" className="mt-4">
          <AccountGroup accounts={evaluations} view={view} />
        </TabsContent>
        <TabsContent value="funded" className="mt-4">
          <AccountGroup accounts={funded} view={view} />
        </TabsContent>
        <TabsContent value="breached" className="mt-4">
          <AccountGroup accounts={breached} view={view} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
