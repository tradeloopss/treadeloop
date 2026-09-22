import { notFound } from "next/navigation"
import { getAdmin } from "@/lib/admin/guard"
import { getBacktestDashboardData } from "@/app/actions/backtest"
import { BacktestDashboard } from "@/components/backtest/backtest-dashboard"

export default async function BacktestDashboardPage() {
  if (!(await getAdmin())) notFound()
  const data = await getBacktestDashboardData()
  return <BacktestDashboard data={data} />
}
