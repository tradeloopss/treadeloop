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
import { cn } from "@/lib/utils"
import { PROP_FIRM_NAMES, getPresetPrograms, type PropFirmPreset } from "@/lib/propfirm-presets"
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
} from "lucide-react"
import { toast } from "sonner"

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

export function RulesForm({ account, onDone }: { account: PropFirmAccount; onDone: () => void }) {
  const initialFirm = account.firmName && PROP_FIRM_NAMES.includes(account.firmName) ? account.firmName : CUSTOM
  const [firm, setFirm] = useState<string>(initialFirm)
  const [program, setProgram] = useState<string>(account.planType ?? "")
  const [customFirmName, setCustomFirmName] = useState(initialFirm === CUSTOM ? (account.firmName ?? "") : "")
  const [phase, setPhase] = useState(account.rules?.phase ?? "evaluation")
  const [profitTargetPct, setProfitTargetPct] = useState(account.rules?.profitTargetPct?.toString() ?? "")
  const [maxDrawdownPct, setMaxDrawdownPct] = useState(account.rules?.maxDrawdownPct?.toString() ?? "")
  const [drawdownType, setDrawdownType] = useState(account.rules?.drawdownType ?? "trailing")
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(account.rules?.dailyLossLimitPct?.toString() ?? "")
  const [minTradingDays, setMinTradingDays] = useState(account.rules?.minTradingDays?.toString() ?? "")
  const [pending, startTransition] = useTransition()

  const programs = firm !== CUSTOM ? getPresetPrograms(firm) : []
  const activePreset: PropFirmPreset | undefined = programs.find((p) => p.program === program)

  function applyPreset(preset: PropFirmPreset) {
    setProfitTargetPct(preset.profitTargetPct?.toString() ?? "")
    setMaxDrawdownPct(preset.maxDrawdownPct.toString())
    setDrawdownType(preset.drawdownType)
    setDailyLossLimitPct(preset.dailyLossLimitPct?.toString() ?? "")
    setMinTradingDays(preset.minTradingDays?.toString() ?? "")
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("firmName", firm === CUSTOM ? customFirmName : firm)
    formData.set("planType", firm === CUSTOM ? "" : program)
    formData.set("phase", phase)
    formData.set("profitTargetPct", profitTargetPct)
    formData.set("maxDrawdownPct", maxDrawdownPct)
    formData.set("drawdownType", drawdownType)
    formData.set("dailyLossLimitPct", dailyLossLimitPct)
    formData.set("minTradingDays", minTradingDays)
    startTransition(async () => {
      try {
        await savePropFirmRules(account.id, formData)
        toast.success("Rules saved")
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save rules")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Prop firm</Label>
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
              <SelectItem value={CUSTOM}>Custom / other firm</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Account type</Label>
          <Select
            value={program}
            onValueChange={(v) => {
              if (!v) return
              setProgram(v)
              const preset = programs.find((p) => p.program === v)
              if (preset) applyPreset(preset)
            }}
            disabled={firm === CUSTOM}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder={firm === CUSTOM ? "—" : "Select…"} /></SelectTrigger>
            <SelectContent>
              {programs.map((p) => (
                <SelectItem key={p.program} value={p.program}>{p.program}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {firm === CUSTOM && (
        <div className="space-y-1.5">
          <Label htmlFor="customFirmName">Firm name</Label>
          <Input
            id="customFirmName"
            placeholder="e.g. My Prop Firm"
            value={customFirmName}
            onChange={(e) => setCustomFirmName(e.target.value)}
          />
        </div>
      )}

      {activePreset && (
        <p className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {activePreset.notes} Fields below are pre-filled but editable — always verify against your firm's current rulebook.
        </p>
      )}

      <div className="space-y-1.5">
        <Label>Phase</Label>
        <Select value={phase} onValueChange={(v) => v && setPhase(v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="evaluation">Evaluation</SelectItem>
            <SelectItem value="verification">Verification</SelectItem>
            <SelectItem value="funded">Funded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="profitTargetPct">Profit target %</Label>
          <Input
            id="profitTargetPct"
            type="number"
            step="0.01"
            placeholder="Leave blank if none"
            value={profitTargetPct}
            onChange={(e) => setProfitTargetPct(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxDrawdownPct">Max drawdown %</Label>
          <Input
            id="maxDrawdownPct"
            type="number"
            step="0.01"
            required
            value={maxDrawdownPct}
            onChange={(e) => setMaxDrawdownPct(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Drawdown type</Label>
          <Select value={drawdownType} onValueChange={(v) => v && setDrawdownType(v as "trailing" | "static")}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="trailing">Trailing (from peak balance)</SelectItem>
              <SelectItem value="static">Static (from starting balance)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dailyLossLimitPct">Daily loss limit %</Label>
          <Input
            id="dailyLossLimitPct"
            type="number"
            step="0.01"
            placeholder="Leave blank if none"
            value={dailyLossLimitPct}
            onChange={(e) => setDailyLossLimitPct(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="minTradingDays">Min trading days</Label>
        <Input
          id="minTradingDays"
          type="number"
          placeholder="Leave blank if none"
          value={minTradingDays}
          onChange={(e) => setMinTradingDays(e.target.value)}
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Percentages are of your account's starting balance. Presets are researched, not official — double check
        against your firm's current rules before relying on this.
      </p>

      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save rules"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function LogTransactionForm({ account, onDone }: { account: PropFirmAccount; onDone: () => void }) {
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
        toast.success("Logged")
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not log transaction")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => v && setType(v as "cost" | "payout")}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cost">Cost (fee / reset)</SelectItem>
              <SelectItem value="payout">Payout received</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {type === "cost" ? (
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => v && setCategory(v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="evaluation_fee">Evaluation fee</SelectItem>
                <SelectItem value="reset_fee">Reset fee</SelectItem>
                <SelectItem value="activation_fee">Activation fee</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="occurredAt">Date</Label>
            <Input id="occurredAt" name="occurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
        )}
      </div>
      {type === "cost" && (
        <div className="space-y-1.5">
          <Label htmlFor="occurredAt">Date</Label>
          <Input id="occurredAt" name="occurredAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="amount">Amount</Label>
        <Input id="amount" name="amount" type="number" step="0.01" required placeholder="0.00" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" placeholder="e.g. 50K reset after breach" />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Log it"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AccountCard({ account }: { account: PropFirmAccount }) {
  const [open, setOpen] = useState(false)
  const [txOpen, setTxOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onRemoveRules() {
    startTransition(async () => {
      try {
        await deletePropFirmRules(account.id)
        toast.success("Rules removed")
      } catch {
        toast.error("Could not remove rules")
      }
    })
  }

  function onSetBreachReason(reason: string) {
    startTransition(async () => {
      try {
        await setBreachReason(account.id, reason === "" ? null : reason)
        toast.success("Saved")
      } catch {
        toast.error("Could not save reason")
      }
    })
  }

  if (!account.rules || !account.evaluation) return null

  const { evaluation, rules } = account
  const meta = STATUS_META[evaluation.status]
  const StatusIcon = meta.icon
  const stepLabel = rules.phase === "evaluation" ? "Step 1" : rules.phase === "verification" ? "Step 2" : "Funded"

  const drawdownPct = (evaluation.currentDrawdownAmount / evaluation.drawdownLimitAmount) * 100
  const dailyLossPct = evaluation.dailyLossLimitAmount ? (evaluation.worstDayLossAmount / evaluation.dailyLossLimitAmount) * 100 : 0
  const ddReference = rules.drawdownType === "trailing" ? evaluation.peakBalance : account.startingBalance
  const floor = ddReference - evaluation.drawdownLimitAmount

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/accounts/${account.id}`} className="text-lg font-semibold hover:underline">{account.name}</Link>
          <span className="text-xs font-medium text-muted-foreground uppercase">{stepLabel}</span>
          <Badge variant="outline" className={cn("uppercase", meta.className)}>
            <StatusIcon className="size-3.5" /> {meta.label}
          </Badge>
          {account.autoDetected && (
            <Badge variant="outline" className="border-primary/30 text-primary uppercase">
              <Sparkles className="size-3.5" /> Verify
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Account actions">
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTxOpen(true)}>
              <Receipt className="size-4" /> Log fee/payout
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOpen(true)}>
              <Settings2 className="size-4" /> Edit rules
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onRemoveRules} disabled={pending}>
              <Trash2 className="size-4" /> Stop tracking
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Balance:</span>{" "}
          <span className="font-semibold tabular-nums">{formatCurrency(evaluation.currentBalance, account.currency)}</span>{" "}
          <span className={cn("font-medium tabular-nums", evaluation.netProfit >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
            ({evaluation.netProfit >= 0 ? "+" : ""}
            {formatCurrency(evaluation.netProfit, account.currency)})
          </span>
        </p>
        <p className="text-sm text-muted-foreground">{account.firmName ?? "Firm not set"}</p>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
        <CalendarClock className="size-4 shrink-0" />
        <span>
          {rules.minTradingDays != null ? `${evaluation.tradingDays}/${rules.minTradingDays} trading days` : "No time limit"}
          {account.trackedSince && <> · Started on {new Date(account.trackedSince).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })}</>}
        </span>
      </div>

      <p className="text-sm">
        <span className="text-muted-foreground">Account:</span> {account.name}
        {account.planType && <span className="text-muted-foreground"> · {account.planType}</span>}
      </p>

      {evaluation.breachReason && (
        <div className="space-y-2 rounded-md border border-[var(--loss)]/30 bg-[var(--loss)]/10 px-3 py-2 text-sm text-[var(--loss)]">
          <p>
            {evaluation.breachReason}
            {evaluation.breachedAt && <> — {new Date(evaluation.breachedAt).toLocaleDateString()}</>}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--loss)]/80">What actually caused it?</span>
            <Select value={account.breachReasonTag ?? ""} onValueChange={(v) => v && onSetBreachReason(v)}>
              <SelectTrigger className="h-7 w-48 bg-background text-xs"><SelectValue placeholder="Tag a reason…" /></SelectTrigger>
              <SelectContent>
                {BREACH_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
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
              <p className="text-sm font-medium">Profit: {formatCurrency(evaluation.netProfit, account.currency)}</p>
              <p className="text-xs text-muted-foreground">Target: {rules.profitTargetPct}%</p>
            </div>
            <div className="flex-1"><Bar pct={evaluation.profitProgressPct ?? 0} tone="gain" /></div>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{Math.round(evaluation.profitProgressPct ?? 0)}%</span>
          </div>
        )}

        {evaluation.dailyLossLimitAmount != null && (
          <div className="flex items-center gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", dailyLossPct < 100 ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
              {dailyLossPct < 100 ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">{formatCurrency(evaluation.worstDayLossAmount, account.currency)}</p>
              <p className="text-xs text-muted-foreground">Maximum daily loss: {rules.dailyLossLimitPct}%</p>
            </div>
            <div className="flex-1"><Bar pct={dailyLossPct} tone="loss" /></div>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{Math.round(dailyLossPct)}%</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", drawdownPct < 100 ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-[var(--loss)]/10 text-[var(--loss)]")}>
            {drawdownPct < 100 ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
          </span>
          <div className="w-40 shrink-0">
            <p className="text-sm font-medium">Drawdown: {formatCurrency(evaluation.currentDrawdownAmount, account.currency)}</p>
            <p className="text-xs text-muted-foreground">
              Max: {formatCurrency(evaluation.drawdownLimitAmount, account.currency)} ({rules.maxDrawdownPct}%) · Floor: {formatCurrency(floor, account.currency)}
            </p>
          </div>
          <div className="flex-1"><Bar pct={drawdownPct} tone="loss" /></div>
          <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{Math.round(drawdownPct)}%</span>
        </div>

        {rules.minTradingDays != null && (
          <div className="flex items-center gap-3">
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", evaluation.minTradingDaysMet ? "bg-[var(--gain)]/10 text-[var(--gain)]" : "bg-muted text-muted-foreground")}>
              <CheckCircle2 className="size-4" />
            </span>
            <div className="w-40 shrink-0">
              <p className="text-sm font-medium">Trading days</p>
              <p className="text-xs text-muted-foreground">Minimum: {rules.minTradingDays}</p>
            </div>
            <div className="flex-1"><Bar pct={(evaluation.tradingDays / rules.minTradingDays) * 100} tone="gain" /></div>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{evaluation.tradingDays}/{rules.minTradingDays}</span>
          </div>
        )}
      </div>

      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log a fee or payout for {account.name}</DialogTitle>
            <DialogDescription>Powers the financial dashboard's spend/earn/ROI totals.</DialogDescription>
          </DialogHeader>
          <LogTransactionForm account={account} onDone={() => setTxOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit rules for {account.name}</DialogTitle>
            <DialogDescription>Update your firm's evaluation rules.</DialogDescription>
          </DialogHeader>
          <RulesForm account={account} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function AccountGroup({ accounts, view }: { accounts: PropFirmAccount[]; view: "list" | "grid" }) {
  if (accounts.length === 0) {
    return (
      <Card className="flex h-32 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Nothing in this group yet.</p>
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
  const [view, setView] = useState<"list" | "grid">("list")

  if (accounts.length === 0) {
    return (
      <Card className="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">
          No prop firm accounts yet — use &quot;Track prop firm account&quot; above to add one.
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
        Status is computed from your closed, synced trades — it can't see floating P&L on a position that's still
        open. Treat this as a tracker, not a final ruling; always confirm with your firm's own dashboard.
      </div>

      <Tabs defaultValue="evaluations">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="evaluations">Evaluations ({evaluations.length})</TabsTrigger>
            <TabsTrigger value="funded">Funded ({funded.length})</TabsTrigger>
            <TabsTrigger value="breached">Breached ({breached.length})</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="List view"
              className={cn("rounded-md p-1.5 transition-colors", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <List className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-label="Grid view"
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
