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

export function PayoutsWorkspace({ initial, isPro }: { initial: PayoutSummary; isPro: boolean }) {
  const [summary, setSummary] = useState(initial)
  const [pending, startTransition] = useTransition()

  function switchPeriod(period: PayoutPeriod) {
    if (period === summary.period) return
    startTransition(async () => {
      try {
        setSummary(await getPayoutSummary(period))
      } catch {
        toast.error("Could not load that period")
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
            { value: "monthly" as const, label: "Monthly" },
            { value: "biweekly" as const, label: "Bi-weekly" },
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
          {pending && <span className="text-xs">· updating…</span>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total payouts"
          value={formatCurrency(summary.total, summary.currency)}
          sub={`${payoutCount} payout${payoutCount === 1 ? "" : "s"} logged`}
          tone={summary.total > 0 ? "gain" : "neutral"}
          icon={<Banknote className="size-4" />}
        />
        <StatCard label="Accounts paid" value={summary.accountCount} sub="In this period" icon={<Wallet className="size-4" />} />
        <StatCard
          label="Avg per account"
          value={formatCurrency(avgPerAccount, summary.currency)}
          sub="Across paid accounts"
          icon={<CalendarRange className="size-4" />}
        />
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-muted-foreground">Payout certificate</h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          Covers every account with a payout in this period. Download it as an image or print it.
        </p>
        <PayoutCertificate summary={summary} isPro={isPro} />
      </Card>

      {summary.lines.length === 0 && (
        <Card className="flex h-32 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            No payouts logged for {summary.periodLabel}. Log one from the Prop Firm Tracker — &quot;Log payout&quot; on any account.
          </p>
        </Card>
      )}
    </div>
  )
}
