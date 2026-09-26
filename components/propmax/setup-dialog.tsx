"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { setupPropMaxAccount } from "@/app/actions/propmax"
import type { CatalogOption } from "@/lib/propmax/view-types"
import type { Detection } from "@/lib/propmax/detect"
import { formatSize, phaseLabel } from "@/components/propmax/display"

// Distinct, order-preserving helper.
function uniqueBy<T, K>(items: T[], key: (t: T) => K): T[] {
  const seen = new Set<K>()
  const out: T[] = []
  for (const it of items) {
    const k = key(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

export function PropMaxSetupDialog({
  accountId,
  accountName,
  catalog,
  detection,
  trigger,
}: {
  accountId: number
  accountName: string
  catalog: CatalogOption[]
  detection?: Detection | null
  trigger: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [firmSlug, setFirmSlug] = useState<string>(detection?.firmSlug ?? "")
  const [programSlug, setProgramSlug] = useState<string>(detection?.programSlug ?? "")
  const [sizeStr, setSizeStr] = useState<string>(detection?.accountSize != null ? String(detection.accountSize) : "")
  const [phase, setPhase] = useState<string>("evaluation")

  const firms = useMemo(() => uniqueBy(catalog, (c) => c.firmSlug).map((c) => ({ slug: c.firmSlug, name: c.firmName })), [catalog])
  const programs = useMemo(
    () => uniqueBy(catalog.filter((c) => c.firmSlug === firmSlug), (c) => c.programSlug).map((c) => ({ slug: c.programSlug, name: c.programName })),
    [catalog, firmSlug],
  )
  const scoped = useMemo(() => catalog.filter((c) => c.firmSlug === firmSlug && c.programSlug === programSlug), [catalog, firmSlug, programSlug])
  const sizes = useMemo(
    () => uniqueBy(scoped, (c) => c.accountSize).map((c) => c.accountSize).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [scoped],
  )
  const phases = useMemo(() => uniqueBy(scoped.filter((c) => String(c.accountSize) === sizeStr), (c) => c.phase).map((c) => c.phase), [scoped, sizeStr])

  const match = scoped.find((c) => String(c.accountSize) === sizeStr && c.phase === phase)

  function pickFirm(v: string) {
    setFirmSlug(v)
    setProgramSlug("")
    setSizeStr("")
  }
  function pickProgram(v: string) {
    setProgramSlug(v)
    setSizeStr("")
  }

  function onSave() {
    if (!match) {
      toast.error("Pick a firm, program, size and phase we have rules for.")
      return
    }
    startTransition(async () => {
      try {
        await setupPropMaxAccount({ accountId, ruleVersionId: match.id })
        toast.success(`Tracking ${accountName} against ${match.firmName} — ${match.programName}.`)
        setOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't set up tracking.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up PropFirm Max</DialogTitle>
          <DialogDescription>
            Choose the firm, program, account size and phase for <span className="font-medium text-foreground">{accountName}</span>. Only combinations
            with verified, sourced rules are offered — nothing is guessed.
          </DialogDescription>
        </DialogHeader>

        {detection?.reason && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{detection.reason}</p>
        )}

        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label>Prop firm</Label>
            <Select value={firmSlug} onValueChange={(v) => v && pickFirm(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a firm" />
              </SelectTrigger>
              <SelectContent>
                {firms.map((f) => (
                  <SelectItem key={f.slug} value={f.slug}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Program</Label>
            <Select value={programSlug} onValueChange={(v) => v && pickProgram(v)} disabled={!firmSlug}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={firmSlug ? "Select a program" : "Pick a firm first"} />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Account size</Label>
              <Select value={sizeStr} onValueChange={(v) => v && setSizeStr(v)} disabled={!programSlug}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Size" />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={String(s)} value={String(s)}>
                      {formatSize(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Phase</Label>
              <Select value={phase} onValueChange={(v) => v && setPhase(v)} disabled={!sizeStr}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Phase" />
                </SelectTrigger>
                <SelectContent>
                  {(phases.length ? phases : ["evaluation"]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {phaseLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {match && (
            <p className="text-xs text-muted-foreground">
              Rules source: <span className="text-foreground">{match.sourceName}</span> · {match.confidence} confidence.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending || !match}>
            {pending ? "Saving…" : "Start tracking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
