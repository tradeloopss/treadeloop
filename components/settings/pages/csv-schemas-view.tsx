"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileSpreadsheet, Plus, Trash2 } from "lucide-react"
import {
  createCsvSchema,
  updateCsvSchema,
  deleteCsvSchema,
  type CsvSchemaRow,
  type CsvSchemaInput,
} from "@/app/actions/settings-lists"
import { CSV_TARGET_FIELDS } from "@/lib/settings/csv-fields"
import { SettingsHeader, SectionLabel, SettingsRows, SettingsRow } from "@/components/settings/chrome"
import { FieldRow, SelectField } from "@/components/settings/controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/components/locale-provider"

const DELIMITERS = [
  { value: ",", label: "Comma ," },
  { value: ";", label: "Semicolon ;" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe |" },
]

const FIELD_LABELS: Record<string, string> = {
  symbol: "Symbol",
  side: "Side",
  quantity: "Quantity",
  entryPrice: "Entry price",
  exitPrice: "Exit price",
  entryTime: "Entry time",
  exitTime: "Exit time",
  pnl: "P&L",
  fees: "Fees",
}

const EMPTY: CsvSchemaInput = { name: "", broker: null, delimiter: ",", dateFormat: null, mapping: {} }

export function CsvSchemasView({ initial }: { initial: CsvSchemaRow[] }) {
  const t = useT()
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-6">
      <SettingsHeader
        icon={FileSpreadsheet}
        title={t("CSV Schemas")}
        right={
          <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
            <Plus className="size-3.5" />
            {t("New schema")}
          </Button>
        }
      />

      <p className="px-1 text-xs text-muted-foreground">
        {t("Save the column layout of a broker's export once, then reuse it every time you import that CSV.")}
      </p>

      {adding && (
        <div className="rounded-lg border bg-card p-4">
          <SchemaForm initial={EMPTY} onDone={() => setAdding(false)} onSave={(v) => createCsvSchema(v)} submitLabel={t("Create schema")} />
        </div>
      )}

      <div className="space-y-3">
        <SectionLabel>{t("Saved Schemas")}</SectionLabel>
        {initial.length === 0 && !adding ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{t("No schemas yet.")}</p>
        ) : (
          <SettingsRows>
            {initial.map((s) => (
              <SettingsRow
                key={s.id}
                icon={FileSpreadsheet}
                title={s.name}
                value={`${s.broker ? `${s.broker} · ` : ""}${Object.values(s.mapping).filter(Boolean).length} ${t("columns")}`}
              >
                <SchemaForm
                  initial={{ name: s.name, broker: s.broker, delimiter: s.delimiter, dateFormat: s.dateFormat, mapping: s.mapping }}
                  onSave={(v) => updateCsvSchema(s.id, v)}
                  onDelete={() => deleteCsvSchema(s.id)}
                  submitLabel={t("Save schema")}
                />
              </SettingsRow>
            ))}
          </SettingsRows>
        )}
      </div>
    </div>
  )
}

function SchemaForm({
  initial,
  onSave,
  onDelete,
  onDone,
  submitLabel,
}: {
  initial: CsvSchemaInput
  onSave: (v: CsvSchemaInput) => Promise<void>
  onDelete?: () => Promise<void>
  onDone?: () => void
  submitLabel: string
}) {
  const t = useT()
  const router = useRouter()
  const [v, setV] = useState<CsvSchemaInput>(initial)
  const [busy, setBusy] = useState(false)
  const setMap = (field: string, col: string) => setV((p) => ({ ...p, mapping: { ...p.mapping, [field]: col } }))

  async function submit() {
    if (!v.name.trim()) return toast.error(t("Name is required"))
    setBusy(true)
    try {
      await onSave(v)
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
          <Input value={v.name} onChange={(e) => setV((p) => ({ ...p, name: e.target.value }))} placeholder={t("e.g. Tradovate export")} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Broker / platform")}</Label>
          <Input value={v.broker ?? ""} onChange={(e) => setV((p) => ({ ...p, broker: e.target.value }))} placeholder={t("Optional")} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Delimiter")}</Label>
          <SelectField value={v.delimiter} onChange={(d) => setV((p) => ({ ...p, delimiter: d }))} options={DELIMITERS} className="w-full" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Date format")}</Label>
          <Input value={v.dateFormat ?? ""} onChange={(e) => setV((p) => ({ ...p, dateFormat: e.target.value }))} placeholder="YYYY-MM-DD HH:mm:ss" />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">{t("Column mapping")}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {CSV_TARGET_FIELDS.map((field) => (
            <FieldRow key={field} label={t(FIELD_LABELS[field] ?? field)}>
              <Input
                value={v.mapping[field] ?? ""}
                onChange={(e) => setMap(field, e.target.value)}
                placeholder={t("CSV column")}
                className="w-40"
              />
            </FieldRow>
          ))}
        </div>
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
