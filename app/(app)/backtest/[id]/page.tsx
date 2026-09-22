import { notFound } from "next/navigation"
import Link from "next/link"
import { getBacktestSession } from "@/app/actions/backtest"
import { buttonVariants } from "@/components/ui/button"
import { BacktestWorkspace, type WorkspaceSession } from "@/components/backtest/backtest-workspace"
import { getT } from "@/lib/i18n/server"
import { ChevronLeft } from "lucide-react"

const toSec = (d: Date) => Math.floor(new Date(d).getTime() / 1000)

export default async function BacktestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getT()
  const session = await getBacktestSession(Number(id))
  if (!session) notFound()

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
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/backtest" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={t("Back")}>
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="truncate text-sm font-semibold">{session.name || session.symbol}</h1>
        </div>
        <span className="text-xs text-muted-foreground">{t("Backtest")}</span>
      </div>
      <BacktestWorkspace session={ws} />
    </div>
  )
}
