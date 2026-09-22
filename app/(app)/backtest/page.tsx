import { redirect } from "next/navigation"
import { getAdmin } from "@/lib/admin/guard"
import { BacktestComingSoon } from "@/components/backtest/backtest-coming-soon"

// Entry point for the Backtesting section. Admins land on the dashboard;
// everyone else sees the coming-soon screen (the feature is still admin-only).
export default async function BacktestIndex() {
  if (!(await getAdmin())) return <BacktestComingSoon />
  redirect("/backtest/dashboard")
}
