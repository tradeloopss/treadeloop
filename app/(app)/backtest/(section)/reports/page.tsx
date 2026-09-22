import { notFound } from "next/navigation"
import { getAdmin } from "@/lib/admin/guard"
import { getBacktestDashboardData } from "@/app/actions/backtest"
import { Card } from "@/components/ui/card"
import { getT } from "@/lib/i18n/server"

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)
const pf = (n: number) => (n === Infinity ? "∞" : n.toFixed(2))

export default async function BacktestReportsPage() {
  if (!(await getAdmin())) notFound()
  const t = await getT()
  const d = await getBacktestDashboardData()

  const metrics: { label: string; value: string }[] = [
    { label: t("Net P&L"), value: usd(d.netPnl) },
    { label: t("Total trades"), value: String(d.totalTrades) },
    { label: t("Win rate"), value: `${d.tradeWinRate.toFixed(1)}%` },
    { label: t("Profit factor"), value: pf(d.profitFactor) },
    { label: t("Expectancy"), value: usd(d.tradeExpectancy) },
    { label: t("Avg R"), value: `${d.avgRMultiple.toFixed(2)}R` },
    { label: t("Avg winner"), value: usd(d.avgWin) },
    { label: t("Avg loser"), value: usd(d.avgLoss) },
    { label: t("Max drawdown"), value: `-${usd(d.maxDrawdown)}` },
    { label: t("Winning days"), value: String(d.winningDays) },
    { label: t("Losing days"), value: String(d.losingDays) },
    { label: t("Long / Short"), value: `${d.longCount} / ${d.shortCount}` },
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {d.totalTrades === 0 ? (
        <Card className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">{t("No backtest data yet — run a session to see reports.")}</Card>
      ) : (
        <>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">{t("Summary")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {metrics.map((m) => (
                <div key={m.label} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{m.label}</div>
                  <div className="text-base font-semibold tabular-nums">{m.value}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">{t("By instrument")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">{t("Symbol")}</th>
                    <th className="py-2 text-right font-medium">{t("Trades")}</th>
                    <th className="py-2 text-right font-medium">{t("Win rate")}</th>
                    <th className="py-2 text-right font-medium">{t("Net P&L")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.bySymbol.map((s) => (
                    <tr key={s.symbol} className="border-b last:border-0">
                      <td className="py-2 font-medium">{s.symbol}</td>
                      <td className="py-2 text-right tabular-nums">{s.trades}</td>
                      <td className="py-2 text-right tabular-nums">{s.winRate.toFixed(0)}%</td>
                      <td className={`py-2 text-right font-semibold tabular-nums ${s.pnl > 0 ? "text-emerald-600 dark:text-emerald-400" : s.pnl < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {usd(s.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
