import { getBacktestSessions } from "@/app/actions/backtest"
import { BacktestManager, type BacktestSessionCard } from "@/components/backtest/backtest-manager"

export default async function BacktestSessionsPage() {
  const sessions = await getBacktestSessions()
  const cards: BacktestSessionCard[] = sessions.map((s) => ({
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    timeframe: s.timeframe,
    status: s.status,
    startingBalance: Number(s.startingBalance),
    currentBalance: Number(s.currentBalance),
    randomMode: s.randomMode,
    createdAt: s.createdAt.toISOString(),
  }))

  return (
    <div className="p-4 sm:p-6">
      <BacktestManager sessions={cards} />
    </div>
  )
}
