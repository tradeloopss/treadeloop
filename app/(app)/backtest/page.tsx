import { redirect } from "next/navigation"
import { getBetaUser } from "@/lib/beta"
import { BacktestComingSoon } from "@/components/backtest/backtest-coming-soon"

// Entry point for the Backtesting section. The team and anyone with beta access
// (lib/beta.ts) land on the dashboard; everyone else sees the coming-soon screen.
export default async function BacktestIndex() {
  if (!(await getBetaUser())) return <BacktestComingSoon />
  redirect("/backtest/dashboard")
}
