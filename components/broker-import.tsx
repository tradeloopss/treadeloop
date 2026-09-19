"use client"

import type React from "react"
import { useRef, useState, useTransition } from "react"
import { importTradeCsv } from "@/app/actions/broker"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { Upload, FileSpreadsheet } from "lucide-react"
import { useT } from "@/components/locale-provider"

export function BrokerImport({ accounts }: { accounts: { id: number; name: string }[] }) {
  const t = useT()
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string>("auto")
  const inputRef = useRef<HTMLInputElement>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set("accountId", accountId === "auto" ? "" : accountId)
    startTransition(async () => {
      try {
        const result = await importTradeCsv(formData)
        if (result.imported > 0) {
          toast.success(result.imported === 1 ? t("Imported 1 trade from {source}", { source: result.source }) : t("Imported {n} trades from {source}", { n: result.imported, source: result.source }))
        } else {
          toast.success(t("No new trades — already up to date"))
        }
        if (result.skippedRows > 0) {
          toast.message(result.skippedRows === 1 ? t("Skipped 1 unreadable row") : t("Skipped {n} unreadable rows", { n: result.skippedRows }))
        }
        setFileName(null)
        if (inputRef.current) inputRef.current.value = ""
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Import failed"))
      }
    })
  }

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div>
        <h2 className="font-medium">{t("Import trades")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Works with any of these exports — no login or API key needed.")}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Tradovate:</span> {t("Reports → Orders → pick a date range → Download CSV")}
          </li>
          <li>
            <span className="font-medium text-foreground">NinjaTrader:</span> {t("Control Center → Trade Performance → Trades tab → right-click → Export")}
          </li>
          <li>
            <span className="font-medium text-foreground">MetaTrader 4/5:</span> {t("Terminal → Account History → right-click → Save as Report (HTML)")}
          </li>
        </ul>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>{t("Import into")}</Label>
          <Select value={accountId} onValueChange={(v) => v && setAccountId(v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("Split automatically by account (recommended)")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {accountId === "auto"
              ? t("One file with trades from several accounts works fine — each account in the file's Account column gets matched to (or creates) its own account here automatically.")
              : t("Every trade in this file will be filed under this one account, regardless of what its Account column says.")}
          </p>
        </div>
        <label
          htmlFor="csv-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground hover:bg-accent/30"
        >
          {fileName ? (
            <>
              <FileSpreadsheet className="size-6 text-primary" />
              <span className="font-medium text-foreground">{fileName}</span>
            </>
          ) : (
            <>
              <Upload className="size-6" />
              <span>{t("Click to choose a file")}</span>
            </>
          )}
        </label>
        <input
          ref={inputRef}
          id="csv-file"
          name="file"
          type="file"
          accept=".csv,.htm,.html"
          required
          onChange={onFileChange}
          className="sr-only"
        />
        <Button type="submit" disabled={pending || !fileName} className="w-full">
          {pending ? t("Importing…") : t("Import trades")}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        {t("Re-uploading the same (or a wider) date range is safe — already-imported trades are skipped automatically. Trades still open at export time won't appear until they're closed and re-exported.")}
      </p>
    </Card>
  )
}
