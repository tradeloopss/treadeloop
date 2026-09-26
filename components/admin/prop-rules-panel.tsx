"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Database, Plus } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { seedPropMaxCatalogAction, createPropRuleVersion } from "@/app/actions/propmax"
import type { RuleConfig, Unit } from "@/lib/propmax/types"

type ProgramOption = { id: number; label: string }

export function PropRulesActions({ programs, seedOnly = false }: { programs: ProgramOption[]; seedOnly?: boolean }) {
  return seedOnly ? <SeedButton /> : <NewVersionDialog programs={programs} />
}

function SeedButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  function onSeed() {
    startTransition(async () => {
      try {
        const r = await seedPropMaxCatalogAction()
        toast.success(`Catalog seeded — ${r.firms} firms, ${r.programs} programs, ${r.versions} new versions.`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't seed.")
      }
    })
  }
  return (
    <Button variant="outline" size="sm" onClick={onSeed} disabled={pending}>
      <Database className="size-4" /> {pending ? "Seeding…" : "Seed from presets"}
    </Button>
  )
}

// One optional threshold field: a value + its unit.
function ThresholdField({
  label,
  value,
  onValue,
  unit,
  onUnit,
  units = ["currency", "percentage"],
  placeholder,
}: {
  label: string
  value: string
  onValue: (v: string) => void
  unit?: string
  onUnit?: (v: string) => void
  units?: Unit[]
  placeholder?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input type="number" inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} placeholder={placeholder} className="flex-1" />
        {onUnit && units.length > 1 && (
          <Select value={unit} onValueChange={(v) => v && onUnit(v)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {units.map((u) => (
                <SelectItem key={u} value={u}>
                  {u === "currency" ? "$" : u === "percentage" ? "%" : u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}

function NewVersionDialog({ programs }: { programs: ProgramOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [programId, setProgramId] = useState("")
  const [accountSize, setAccountSize] = useState("50000")
  const [phase, setPhase] = useState("evaluation")

  const [ddValue, setDdValue] = useState("")
  const [ddUnit, setDdUnit] = useState<string>("currency")
  const [ddModel, setDdModel] = useState("trailing")
  const [dlValue, setDlValue] = useState("")
  const [dlUnit, setDlUnit] = useState<string>("currency")
  const [ptValue, setPtValue] = useState("")
  const [ptUnit, setPtUnit] = useState<string>("currency")
  const [minDays, setMinDays] = useState("")
  const [consistency, setConsistency] = useState("")

  const [sourceName, setSourceName] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [sourceType, setSourceType] = useState("official_rules")
  const [confidence, setConfidence] = useState("high")
  const [verifiedAt, setVerifiedAt] = useState("")
  const [changeReason, setChangeReason] = useState("")
  const [caveat, setCaveat] = useState("")

  function num(v: string): number | null {
    const n = Number(v)
    return v.trim() !== "" && Number.isFinite(n) ? n : null
  }

  function buildRules(): RuleConfig[] {
    const rules: RuleConfig[] = []
    const dd = num(ddValue)
    if (dd != null) rules.push({ type: "max_drawdown", unit: ddUnit as Unit, value: dd, model: ddModel as "trailing" | "static" | "eod", severity: "account_failure" })
    const dl = num(dlValue)
    if (dl != null) rules.push({ type: "max_daily_loss", unit: dlUnit as Unit, value: dl, severity: "soft_breach" })
    const pt = num(ptValue)
    if (pt != null) rules.push({ type: "profit_target", unit: ptUnit as Unit, value: pt })
    const md = num(minDays)
    if (md != null) rules.push({ type: "min_trading_days", unit: "days", value: md })
    const cons = num(consistency)
    if (cons != null) rules.push({ type: "consistency", unit: "percentage", value: cons })
    return rules
  }

  function onSave() {
    if (!programId) {
      toast.error("Pick a program.")
      return
    }
    if (!sourceName.trim()) {
      toast.error("A source is required.")
      return
    }
    const rules = buildRules()
    if (rules.length === 0) {
      toast.error("Enter at least one rule (max drawdown at minimum).")
      return
    }
    startTransition(async () => {
      try {
        const r = await createPropRuleVersion({
          programId: Number(programId),
          accountSize: num(accountSize),
          phase,
          rules,
          sourceName,
          sourceUrl: sourceUrl || null,
          sourceType,
          confidence,
          verifiedAt: verifiedAt || null,
          changeReason: changeReason || null,
          caveat: caveat || null,
        })
        toast.success(`Published version ${r.version}.`)
        setOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't publish.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> New rule version
          </Button>
        }
      />
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish a rule version</DialogTitle>
          <DialogDescription>
            The current in-force version for this program/size/phase is retired and this one takes its place. A source is required — rules are never
            published without one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label>Program</Label>
            <Select value={programId} onValueChange={(v) => v && setProgramId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a program" />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Account size (blank = any)</Label>
              <Input type="number" inputMode="numeric" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} placeholder="50000" />
            </div>
            <div className="grid gap-1.5">
              <Label>Phase</Label>
              <Select value={phase} onValueChange={(v) => v && setPhase(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="evaluation">Evaluation</SelectItem>
                  <SelectItem value="verification">Verification</SelectItem>
                  <SelectItem value="funded">Funded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">Rules — leave a field blank if the firm doesn&apos;t have that rule</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Max drawdown</Label>
                <div className="flex gap-2">
                  <Input type="number" inputMode="decimal" value={ddValue} onChange={(e) => setDdValue(e.target.value)} placeholder="2000" className="flex-1" />
                  <Select value={ddUnit} onValueChange={(v) => v && setDdUnit(v)}>
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="currency">$</SelectItem>
                      <SelectItem value="percentage">%</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={ddModel} onValueChange={(v) => v && setDdModel(v)}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trailing">Trailing</SelectItem>
                      <SelectItem value="static">Static</SelectItem>
                      <SelectItem value="eod">End of day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ThresholdField label="Daily loss limit" value={dlValue} onValue={setDlValue} unit={dlUnit} onUnit={setDlUnit} placeholder="optional" />
              <ThresholdField label="Profit target" value={ptValue} onValue={setPtValue} unit={ptUnit} onUnit={setPtUnit} placeholder="optional" />
              <ThresholdField label="Min trading days" value={minDays} onValue={setMinDays} units={["days"]} placeholder="optional" />
              <ThresholdField label="Consistency %" value={consistency} onValue={setConsistency} units={["percentage"]} placeholder="optional" />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">Source (required)</p>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Source name</Label>
                <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="e.g. Apex Trader Funding — Help Center" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Source URL</Label>
                <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Type</Label>
                  <Select value={sourceType} onValueChange={(v) => v && setSourceType(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="official_rules">Official rules</SelectItem>
                      <SelectItem value="help_center">Help center</SelectItem>
                      <SelectItem value="program_docs">Program docs</SelectItem>
                      <SelectItem value="third_party">Third party</SelectItem>
                      <SelectItem value="inferred">Inferred</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Confidence</Label>
                  <Select value={confidence} onValueChange={(v) => v && setConfidence(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Verified on</Label>
                  <Input type="date" value={verifiedAt} onChange={(e) => setVerifiedAt(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Change reason</Label>
            <Input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Why this differs from the last version" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Caveat (optional, shown to users)</Label>
            <Input value={caveat} onChange={(e) => setCaveat(e.target.value)} placeholder="Mechanics the simple model can't capture" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Publishing…" : "Publish version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
