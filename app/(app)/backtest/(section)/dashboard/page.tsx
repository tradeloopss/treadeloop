import { notFound } from "next/navigation"
import { getAdmin } from "@/lib/admin/guard"
import { getBacktestDashboardData, getBacktestSessions } from "@/app/actions/backtest"
import { BacktestDashboard } from "@/components/backtest/backtest-dashboard"
import { BacktestWelcome } from "@/components/backtest/backtest-welcome"

export default async function BacktestDashboardPage() {
  if (!(await getAdmin())) notFound()

  // No sessions yet → the welcome / choose-how-to-test empty state.
  const sessions = await getBacktestSessions()
  if (sessions.length === 0) return <BacktestWelcome />

  const data = await getBacktestDashboardData()
  return <BacktestDashboard data={data} />
}
