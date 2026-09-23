"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { deleteBacktestSession } from "@/app/actions/backtest"
import { CreateSessionDialog } from "@/components/backtest/create-session-dialog"
import { useT } from "@/components/locale-provider"
import { Trash2 } from "lucide-react"

export interface BacktestSessionCard {
  id: number
  name: string | null
  symbol: string
  timeframe: string
  status: string
  startingBalance: number
  currentBalance: number
  randomMode: boolean
  createdAt: string
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)

export function BacktestManager({ sessions, playbooks = [] }: { sessions: BacktestSessionCard[]; playbooks?: { id: number; name: string }[] }) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function onDelete(id: number) {
    startTransition(async () => {
      try {
        await deleteBacktestSession(id)
        toast.success(t("Backtest deleted"))
        router.refresh()
      } catch {
        toast.error(t("Could not delete the backtest"))
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("Your sessions")}</h2>
          <p className="text-sm text-muted-foreground">{t("Create a session to replay a market and place simulated trades.")}</p>
        </div>
        <CreateSessionDialog playbooks={playbooks} />
      </div>

      <div className="space-y-3">
        {sessions.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{t("No sessions yet — create one above.")}</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => {
              const pnl = s.currentBalance - s.startingBalance
              return (
                <Card key={s.id} className="gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{s.name || s.symbol}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.symbol} · {s.timeframe}
                      </div>
                    </div>
                    <Badge variant={s.status === "completed" ? "secondary" : "outline"}>{t(s.status)}</Badge>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{t("Balance")}</span>
                    <span className="font-medium tabular-nums">{usd(s.currentBalance)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{t("P&L")}</span>
                    <span className={`font-semibold tabular-nums ${pnl > 0 ? "text-emerald-600 dark:text-emerald-400" : pnl < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {pnl >= 0 ? "+" : ""}
                      {usd(pnl)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={() => router.push(`/backtest/${s.id}`)}>
                      {s.status === "completed" ? t("View") : t("Open")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDelete(s.id)} disabled={pending} aria-label={t("Delete")}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
