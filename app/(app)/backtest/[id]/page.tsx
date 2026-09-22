import { notFound } from "next/navigation"
import Link from "next/link"
import { getBacktestSession, getBacktestTrades } from "@/app/actions/backtest"
import { buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BacktestWorkspace, type WorkspaceSession } from "@/components/backtest/backtest-workspace"
import { BacktestResults, type ResultsData } from "@/components/backtest/backtest-results"
import { analyze } from "@/lib/calc"
import { getAdmin } from "@/lib/admin/guard"
import { getT } from "@/lib/i18n/server"
import { ChevronLeft } from "lucide-react"

const toSec = (d: Date) => Math.floor(new Date(d).getTime() / 1000)

export default async function BacktestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Admin-only while in progress (a non-admin has no sessions anyway).
  if (!(await getAdmin())) notFound()
  const t = await getT()
  const session = await getBacktestSession(Number(id))
  if (!session) notFound()

  const header = (
    <div className="flex items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Link href="/backtest/sessions" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={t("Back")}>
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="truncate text-sm font-semibold">{session.name || session.symbol}</h1>
        {session.status === "completed" && <Badge variant="secondary">{t("Completed")}</Badge>}
      </div>
      <span className="text-xs text-muted-foreground">
        {session.symbol} · {session.timeframe}
      </span>
    </div>
  )

  if (session.status === "completed") {
    const rows = await getBacktestTrades(session.id)
    const startingBalance = Number(session.startingBalance)
    const analytics = analyze(
      rows.map((r) => ({ pnl: Number(r.pnl), entryTime: r.entryTime, exitTime: r.exitTime, rMultiple: r.rMultiple != null ? Number(r.rMultiple) : null, status: r.status })),
    )
    const sorted = [...rows].sort((a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime())
    let eq = startingBalance
    const equity = [{ i: 0, equity: eq }]
    sorted.forEach((r, idx) => {
      eq += Number(r.pnl)
      equity.push({ i: idx + 1, equity: eq })
    })
    const pnls = rows.map((r) => Number(r.pnl))
    const data: ResultsData = {
      analytics,
      returnPct: startingBalance ? (analytics.netPnl / startingBalance) * 100 : 0,
      breakeven: pnls.filter((p) => p === 0).length,
      best: pnls.length ? Math.max(...pnls) : 0,
      worst: pnls.length ? Math.min(...pnls) : 0,
      equity,
      startingBalance,
      endingBalance: Number(session.currentBalance),
    }
    return (
      <div>
        {header}
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("This backtest ended with no trades.")}</p>
        ) : (
          <BacktestResults data={data} />
        )}
      </div>
    )
  }

  const ws: WorkspaceSession = {
    id: session.id,
    symbol: session.symbol,
    market: session.market,
    timeframe: session.timeframe,
    provider: session.provider,
    rangeStart: toSec(session.rangeStart),
    rangeEnd: toSec(session.rangeEnd),
    currentTime: toSec(session.currentTime),
    startingBalance: Number(session.startingBalance),
    currentBalance: Number(session.currentBalance),
    speed: session.speed,
    status: session.status,
    randomMode: session.randomMode,
  }

  return (
    <div>
      {header}
      <BacktestWorkspace session={ws} />
    </div>
  )
}
