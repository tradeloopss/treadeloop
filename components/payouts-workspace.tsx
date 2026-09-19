"use client"

import { useState, useTransition } from "react"
import { getPayoutSummary } from "@/app/actions/payouts"
import type { PayoutPeriod, PayoutSummary } from "@/lib/payout-period"
import { formatCurrency } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { StatCard } from "@/components/stat-card"
import { PayoutCertificate } from "@/components/payout-certificate"
import { Banknote, CalendarRange, Wallet } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

export function PayoutsWorkspace({ initial, isPro }: { initial: PayoutSummary; isPro: boolean }) {
  const t = useT()
  const [summary, setSummary] = useState(initial)
  const [pending, startTransition] = useTransition()

  function switchPeriod(period: PayoutPeriod) {
    if (period === summary.period) return
    startTransition(async () => {
      try {
        setSummary(await getPayoutSummary(period))
      } catch {
        toast.error(t("Could not load that period"))
      }
    })
  }

  const avgPerAccount = summary.accountCount > 0 ? summary.total / summary.accountCount : 0
  const payoutCount = summary.lines.reduce((sum, l) => sum + l.count, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
          {([
            { value: "monthly" as const, label: t("Monthly") },
            { value: "biweekly" as const, label: t("Bi-weekly") },
          ]).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => switchPeriod(opt.value)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                summary.period === opt.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarRange className="size-4" /> {summary.periodLabel}
          {pending && <span className="text-xs">· {t("updating…")}</span>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("Total payouts")}
          value={formatCurrency(summary.total, summary.currency)}
          sub={payoutCount === 1 ? t("1 payout logged") : t("{n} payouts logged", { n: payoutCount })}
          tone={summary.total > 0 ? "gain" : "neutral"}
          icon={<Banknote className="size-4" />}
        />
        <StatCard label={t("Accounts paid")} value={summary.accountCount} sub={t("In this period")} icon={<Wallet className="size-4" />} />
        <StatCard
          label={t("Avg per account")}
          value={formatCurrency(avgPerAccount, summary.currency)}
          sub={t("Across paid accounts")}
          icon={<CalendarRange className="size-4" />}
        />
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-muted-foreground">{t("Payout certificate")}</h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          {t("Covers every account with a payout in this period. Download it as an image or print it.")}
        </p>
        <PayoutCertificate summary={summary} isPro={isPro} />
      </Card>

      {summary.lines.length === 0 && (
        <Card className="flex h-32 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            {t("No payouts logged for {period}. Log one from the Prop Firm Tracker — “Log payout” on any account.", { period: summary.periodLabel })}
          </p>
        </Card>
      )}
    </div>
  )
}
