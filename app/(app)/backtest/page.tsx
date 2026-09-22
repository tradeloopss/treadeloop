import { getBacktestSessions } from "@/app/actions/backtest"
import { PageHeader } from "@/components/page-header"
import { BacktestManager, type BacktestSessionCard } from "@/components/backtest/backtest-manager"
import { BacktestComingSoon } from "@/components/backtest/backtest-coming-soon"
import { getAdmin } from "@/lib/admin/guard"
import { getT } from "@/lib/i18n/server"

export default async function BacktestPage() {
  // Admin-only while the feature is still in progress; everyone else sees the
  // coming-soon screen. Non-admins never reach the session server actions.
  const admin = await getAdmin()
  if (!admin) return <BacktestComingSoon />

  const t = await getT()
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
    <div>
      <PageHeader
        title={t("Backtesting")}
        description={t("Replay historical markets candle by candle, place simulated trades, and send the results straight into your journal.")}
      />
      <div className="p-4 sm:p-6">
        <BacktestManager sessions={cards} />
      </div>
    </div>
  )
}
