"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DailyPnlShareDialog, type DailyPnlCardData } from "@/components/daily-pnl-card"
import type { BrokerBreakdown } from "@/app/actions/daily-pnl-share"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { resolvePnlPeriod, type PnlPeriod } from "@/lib/pnl-period"
import { Award, CalendarDays, CalendarRange } from "lucide-react"

export interface DailyAccountRow {
  id: number
  name: string
  currency: string
  startingBalance: number
  pnl: number
  trades: number
  wins: number
  losses: number
}

export interface AllAccountsSummary {
  pnl: number
  breakdown: BrokerBreakdown[]
  currency: string
  accountCount: number
}

const ALL = "__all__"

export function PnlCertificateButton({
  accounts,
  weeklyAccounts,
  allAccounts,
  allAccountsWeekly,
  date,
  traderName,
  traderImage,
  isPro,
}: {
  accounts: DailyAccountRow[]
  weeklyAccounts: DailyAccountRow[]
  allAccounts: AllAccountsSummary
  allAccountsWeekly: AllAccountsSummary
  date: string
  traderName: string
  traderImage?: string | null
  isPro?: boolean
}) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [periodOpen, setPeriodOpen] = useState(false)
  const [period, setPeriod] = useState<PnlPeriod | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(accounts.length === 1 ? String(accounts[0].id) : null)
  const [shareOpen, setShareOpen] = useState(false)

  // Step 1 is always the period; step 2 (the account picker) is skipped when
  // there's only one account to choose from.
  function onClick() {
    if (accounts.length === 0) return
    setPeriodOpen(true)
  }

  function choosePeriod(next: PnlPeriod) {
    setPeriod(next)
    setPeriodOpen(false)
    if (accounts.length === 1) {
      setSelected(String(accounts[0].id))
      setShareOpen(true)
    } else {
      setPickerOpen(true)
    }
  }

  const isWeekly = period === "weekly"
  const rows = isWeekly ? weeklyAccounts : accounts
  const totals = isWeekly ? allAccountsWeekly : allAccounts
  const resolved = resolvePnlPeriod(period ?? "daily", date, dateLocale)

  const activeAccount = selected != null && selected !== ALL ? rows.find((a) => a.id === Number(selected)) : null
  const isAll = selected === ALL

  const data: DailyPnlCardData | null =
    period == null
      ? null
      : isAll
        ? {
            period,
            periodLabel: resolved.label,
            scope: "all",
            accountName: null,
            accountCount: totals.accountCount,
            breakdown: totals.breakdown,
            currency: totals.currency,
            date: resolved.start,
            pnl: totals.pnl,
          }
        : activeAccount
          ? {
              period,
              periodLabel: resolved.label,
              scope: "account",
              accountName: activeAccount.name,
              accountCount: 1,
              breakdown: [],
              currency: activeAccount.currency,
              date: resolved.start,
              pnl: activeAccount.pnl,
            }
          : null

  return (
    <>
      <Button variant="outline" onClick={onClick} disabled={accounts.length === 0}>
        <Award className="size-4" /> {t("P&L Certificate")}
      </Button>

      <Dialog open={periodOpen} onOpenChange={setPeriodOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Which period?")}</DialogTitle>
            <DialogDescription>{t("Choose what the certificate should cover.")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => choosePeriod("daily")}
              className="flex flex-col items-start gap-1 rounded-lg border p-4 text-start transition-colors hover:border-primary hover:bg-accent"
            >
              <CalendarDays className="size-5 text-primary" />
              <span className="text-sm font-semibold">{t("Daily")}</span>
              <span className="text-xs text-muted-foreground">{resolvePnlPeriod("daily", date, dateLocale).label}</span>
            </button>
            <button
              type="button"
              onClick={() => choosePeriod("weekly")}
              className="flex flex-col items-start gap-1 rounded-lg border p-4 text-start transition-colors hover:border-primary hover:bg-accent"
            >
              <CalendarRange className="size-5 text-primary" />
              <span className="text-sm font-semibold">{t("Weekly")}</span>
              <span className="text-xs text-muted-foreground">{resolvePnlPeriod("weekly", date, dateLocale).label}</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Which account?")}</DialogTitle>
            <DialogDescription>
              {isWeekly ? t("Generate a shareable weekly P&L certificate for {period}.", { period: resolved.label }) : t("Generate a shareable daily P&L certificate for {period}.", { period: resolved.label })}
            </DialogDescription>
          </DialogHeader>
          <Select
            value={selected ?? undefined}
            onValueChange={(v) => {
              if (!v) return
              setSelected(v)
              setPickerOpen(false)
              setShareOpen(true)
            }}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder={t("Choose an account…")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("All accounts")}</SelectItem>
              {rows.map((acc) => (
                <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DialogContent>
      </Dialog>

      {data && (
        <DailyPnlShareDialog
          accountId={isAll ? null : (activeAccount?.id ?? null)}
          data={data}
          traderName={traderName}
          traderImage={traderImage}
          isPro={isPro}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </>
  )
}
