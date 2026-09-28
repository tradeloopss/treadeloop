"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { LayoutTemplate, Plus, Trash2 } from "lucide-react"
import {
  createTradeTemplate,
  updateTradeTemplate,
  deleteTradeTemplate,
  type TradeTemplateRow,
  type TradeTemplateInput,
} from "@/app/actions/settings-lists"
import { SettingsHeader, SectionLabel, SettingsRows, SettingsRow } from "@/components/settings/chrome"
import { FieldRow, SegmentedControl } from "@/components/settings/controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useT } from "@/components/locale-provider"

type Form = {
  name: string
  symbol: string
  side: "" | "long" | "short"
  quantity: string
  stopLoss: string
  takeProfit: string
  riskPercent: string
  notes: string
}

const EMPTY: Form = { name: "", symbol: "", side: "", quantity: "", stopLoss: "", takeProfit: "", riskPercent: "", notes: "" }

function toInput(f: Form): TradeTemplateInput {
  const num = (s: string) => (s.trim() === "" ? null : Number(s))
  return {
    name: f.name,
    symbol: f.symbol || null,
    side: f.side || null,
    quantity: num(f.quantity),
    fields: {
      stopLoss: num(f.stopLoss),
      takeProfit: num(f.takeProfit),
      riskPercent: num(f.riskPercent),
      notes: f.notes.trim() || null,
    },
  }
}

function fromRow(r: TradeTemplateRow): Form {
  const f = r.fields as { stopLoss?: number; takeProfit?: number; riskPercent?: number; notes?: string }
  const str = (v: unknown) => (v == null ? "" : String(v))
  return {
    name: r.name,
    symbol: r.symbol ?? "",
    side: (r.side as "long" | "short" | null) ?? "",
    quantity: str(r.quantity),
    stopLoss: str(f.stopLoss),
    takeProfit: str(f.takeProfit),
    riskPercent: str(f.riskPercent),
    notes: f.notes ?? "",
  }
}

export function TradeTemplatesView({ initial }: { initial: TradeTemplateRow[] }) {
  const t = useT()
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-6">
      <SettingsHeader
        icon={LayoutTemplate}
        title={t("Trade Templates")}
        right={
          <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
            <Plus className="size-3.5" />
            {t("New template")}
          </Button>
        }
      />

      <p className="px-1 text-xs text-muted-foreground">
        {t("Prefill the Add Trade form with a saved instrument, size, stop and target you use often.")}
      </p>

      {adding && (
        <div className="rounded-lg border bg-card p-4">
          <TemplateForm initial={EMPTY} onDone={() => setAdding(false)} onSave={(v) => createTradeTemplate(v)} submitLabel={t("Create template")} />
        </div>
      )}

      <div className="space-y-3">
        <SectionLabel>{t("Saved Templates")}</SectionLabel>
        {initial.length === 0 && !adding ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{t("No templates yet.")}</p>
        ) : (
          <SettingsRows>
            {initial.map((tpl) => (
              <SettingsRow
                key={tpl.id}
                icon={LayoutTemplate}
                title={tpl.name}
                value={[tpl.symbol, tpl.side, tpl.quantity].filter(Boolean).join(" · ") || undefined}
              >
                <TemplateForm
                  initial={fromRow(tpl)}
                  onSave={(v) => updateTradeTemplate(tpl.id, v)}
                  onDelete={() => deleteTradeTemplate(tpl.id)}
                  submitLabel={t("Save template")}
                />
              </SettingsRow>
            ))}
          </SettingsRows>
        )}
      </div>
    </div>
  )
}

function TemplateForm({
  initial,
  onSave,
  onDelete,
  onDone,
  submitLabel,
}: {
  initial: Form
  onSave: (v: TradeTemplateInput) => Promise<void>
  onDelete?: () => Promise<void>
  onDone?: () => void
  submitLabel: string
}) {
  const t = useT()
  const router = useRouter()
  const [f, setF] = useState<Form>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  async function submit() {
    if (!f.name.trim()) return toast.error(t("Name is required"))
    setBusy(true)
    try {
      await onSave(toInput(f))
      toast.success(t("Saved"))
      onDone?.()
      router.refresh()
    } catch {
      toast.error(t("Could not save changes"))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!onDelete) return
    setBusy(true)
    try {
      await onDelete()
      toast.success(t("Deleted"))
      router.refresh()
    } catch {
      toast.error(t("Could not delete"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("Name")}</Label>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. NQ scalp")} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Symbol")}</Label>
          <Input value={f.symbol} onChange={(e) => set("symbol", e.target.value)} placeholder="NQ" />
        </div>
      </div>

      <FieldRow label={t("Side")}>
        <SegmentedControl
          value={f.side}
          onChange={(v) => set("side", v)}
          options={[
            { value: "", label: t("Any") },
            { value: "long", label: t("Long") },
            { value: "short", label: t("Short") },
          ]}
        />
      </FieldRow>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label>{t("Quantity")}</Label>
          <Input type="number" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Stop loss")}</Label>
          <Input type="number" value={f.stopLoss} onChange={(e) => set("stopLoss", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Take profit")}</Label>
          <Input type="number" value={f.takeProfit} onChange={(e) => set("takeProfit", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Risk %")}</Label>
          <Input type="number" value={f.riskPercent} onChange={(e) => set("riskPercent", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("Notes")}</Label>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder={t("Setup notes to prefill…")} />
      </div>

      <div className="flex items-center justify-between">
        {onDelete ? (
          <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
            <Trash2 className="size-3.5" />
            {t("Delete")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {onDone && (
            <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
              {t("Cancel")}
            </Button>
          )}
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? t("Saving…") : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
