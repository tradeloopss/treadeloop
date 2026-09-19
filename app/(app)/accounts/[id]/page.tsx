import type React from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { getAccount } from "@/app/actions/accounts"
import { getAccountTrades } from "@/app/actions/trades"
import { getPropFirmAccounts } from "@/app/actions/propfirm"
import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { computeDayPnl } from "@/lib/day-pnl"
import { computeTradingScore } from "@/lib/trading-score"
import { computePerformanceSummary } from "@/lib/performance-summary"
import type { ReportTrade } from "@/components/period-insights"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { EquityCurve, type EquityPoint } from "@/components/equity-curve"
import { TradingScore } from "@/components/trading-score"
import { DailyPnlMini, type DailyPnlPoint } from "@/components/daily-pnl-mini"
import { CurrentWeekCalendar } from "@/components/current-week-calendar"
import { LastWeekReport } from "@/components/last-week-report"
import { PerformanceSummaryCard } from "@/components/performance-summary"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { DollarSign, Percent, Scale, Activity, TrendingUp, ArrowLeft, ShieldCheck, ShieldAlert, ShieldQuestion, Wallet } from "lucide-react"
import { getLocale, getT } from "@/lib/i18n/server"
import { intlLocale } from "@/lib/i18n"

const STATUS_META = {
  active: { label: "Active", icon: ShieldQuestion, className: "border-primary/30 text-primary" },
  passed: { label: "Passed", icon: ShieldCheck, className: "border-[var(--gain)]/30 text-[var(--gain)]" },
  breached: { label: "Breached", icon: ShieldAlert, className: "border-[var(--loss)]/30 text-[var(--loss)]" },
}

export default async function AccountDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isFinite(id)) notFound()
  const t = await getT()
  // The recent-trades loop names each trade `t`; the translator is `tr` there.
  const tr = t
  const dateLocale = intlLocale(await getLocale())

  const [account, rows, propFirmAccounts] = await Promise.all([
    getAccount(id),
    getAccountTrades(id),
    getPropFirmAccounts(),
  ])
  if (!account) notFound()

  const propFirm = propFirmAccounts.find((a) => a.id === id) ?? null

  const reportTrades: ReportTrade[] = rows.map((t) => ({
    symbol: t.symbol,
    market: t.market,
    side: t.side as "long" | "short",
    status: t.status as "open" | "closed",
    pnl: Number(t.pnl),
    rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
    rating: t.rating,
    mistakes: t.mistakes ?? [],
    entryTime: new Date(t.entryTime),
    exitTime: t.exitTime ? new Date(t.exitTime) : null,
  }))

  const stats: TradeStat[] = rows.map((t) => ({
    pnl: Number(t.pnl),
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    rMultiple: t.rMultiple == null ? null : Number(t.rMultiple),
    status: t.status,
  }))
  const a = analyze(stats)
  const dayPnlByDay = computeDayPnl(rows)
  const tradingScore = computeTradingScore(stats)
  const performanceSummary = computePerformanceSummary(stats)

  const closed = rows
    .filter((t) => t.status === "closed")
    .sort((x, y) => new Date(x.exitTime ?? x.entryTime).getTime() - new Date(y.exitTime ?? y.entryTime).getTime())
  let running = 0
  const equity: EquityPoint[] = [{ label: t("Start"), equity: 0 }]
  for (const t of closed) {
    running += Number(t.pnl)
    equity.push({
      label: new Date(t.exitTime ?? t.entryTime).toLocaleDateString(dateLocale, { month: "short", day: "numeric" }),
      equity: Number(running.toFixed(2)),
    })
  }

  const pnlByDay = new Map<string, number>()
  for (const t of closed) {
    const day = new Date(t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
    pnlByDay.set(day, (pnlByDay.get(day) ?? 0) + Number(t.pnl))
  }
  let dailyRunning = 0
  const dailyPnl: DailyPnlPoint[] = Array.from(pnlByDay.entries())
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([day, pnl]) => {
      dailyRunning += pnl
      return {
        label: new Date(day).toLocaleDateString(dateLocale, { month: "short", day: "numeric" }),
        cumulative: Number(dailyRunning.toFixed(2)),
      }
    })

  const recent = rows.slice(0, 5)
  const pf = Number.isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : "∞"
  const balance = account.currentBalance != null ? Number(account.currentBalance) : Number(account.startingBalance) + a.netPnl

  return (
    <div>
      <PageHeader
        title={account.name}
        description={`${account.broker ?? t("Manual account")} · ${account.currency}`}
        action={
          <Link href="/trades" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {t("All accounts")}
          </Link>
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label={t("Balance")} value={formatCurrency(balance, account.currency)} sub={account.name} icon={<Wallet className="size-4" />} />
          <StatCard
            label={t("Net P&L")}
            value={formatCurrency(a.netPnl, account.currency)}
            tone={a.netPnl > 0 ? "gain" : a.netPnl < 0 ? "loss" : "neutral"}
            sub={a.totalTrades === 1 ? t("1 closed trade") : t("{n} closed trades", { n: a.totalTrades })}
            icon={<DollarSign className="size-4" />}
          />
          <StatCard label={t("Win Rate")} value={`${a.winRate.toFixed(1)}%`} sub={t("{w}W / {l}L", { w: a.wins, l: a.losses })} icon={<Percent className="size-4" />} />
          <StatCard label={t("Profit Factor")} value={pf} sub={t("Gross profit ÷ gross loss")} icon={<Scale className="size-4" />} />
          <StatCard
            label={t("Expectancy")}
            value={formatCurrency(a.expectancy, account.currency)}
            tone={a.expectancy > 0 ? "gain" : a.expectancy < 0 ? "loss" : "neutral"}
            sub={t("Avg P&L per trade")}
            icon={<Activity className="size-4" />}
          />
        </div>

        {propFirm?.rules && propFirm.evaluation && (
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">{t("Prop firm status")}</h2>
                <Badge variant="outline" className="uppercase">{t(propFirm.rules.phase)}</Badge>
                {(() => {
                  const meta = STATUS_META[propFirm.evaluation.status]
                  const Icon = meta.icon
                  return (
                    <Badge variant="outline" className={cn("uppercase", meta.className)}>
                      <Icon className="size-3.5" /> {t(meta.label)}
                    </Badge>
                  )
                })()}
              </div>
              <Link href="/propfirm" className="text-xs font-medium text-primary hover:underline">
                {t("Manage rules & payouts")}
              </Link>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
              {propFirm.evaluation.profitTargetAmount != null && (
                <div>
                  <p className="text-muted-foreground">{t("Profit target progress")}</p>
                  <p className="mt-1 font-semibold tabular-nums text-[var(--gain)]">
                    {formatCurrency(propFirm.evaluation.netProfit, account.currency)} / {formatCurrency(propFirm.evaluation.profitTargetAmount, account.currency)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">{t("Drawdown remaining")}</p>
                <p className="mt-1 font-semibold tabular-nums text-[var(--loss)]">
                  {formatCurrency(propFirm.evaluation.drawdownRemainingAmount, account.currency)}
                </p>
              </div>
              {propFirm.evaluation.dailyLossLimitAmount != null && (
                <div>
                  <p className="text-muted-foreground">{t("Worst day / daily limit")}</p>
                  <p className="mt-1 font-semibold tabular-nums text-[var(--loss)]">
                    {formatCurrency(propFirm.evaluation.worstDayLossAmount, account.currency)} / {formatCurrency(propFirm.evaluation.dailyLossLimitAmount, account.currency)}
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CurrentWeekCalendar byDay={dayPnlByDay} />
          </div>
          <TradingScore overall={tradingScore.overall} axes={tradingScore.axes} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LastWeekReport trades={reportTrades} />
          </div>
          <DailyPnlMini data={dailyPnl} />
        </div>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">{t("Equity Curve")}</h2>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(a.netPnl, account.currency)}</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{t("Max DD")} {formatCurrency(-a.maxDrawdown, account.currency)}</span>
              <span>{t("Avg R")} {a.avgRMultiple.toFixed(2)}</span>
            </div>
          </div>
          {equity.length > 1 ? <EquityCurve data={equity} /> : <EmptyState message={t("Log this account's first closed trade to see its equity curve.")} />}
        </Card>

        <PerformanceSummaryCard summary={performanceSummary} />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">{t("Recent Trades")}</h2>
              <Link href="/trades" className="text-xs font-medium text-primary hover:underline">
                {t("View all")}
              </Link>
            </div>
            {recent.length ? (
              <div className="divide-y">
                {recent.map((t) => {
                  const pnl = Number(t.pnl)
                  return (
                    <div key={t.id} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-semibold uppercase",
                            t.side === "long" ? "bg-[var(--gain)]/12 text-[var(--gain)]" : "bg-[var(--loss)]/12 text-[var(--loss)]",
                          )}
                        >
                          {t.side === "long" ? tr("Long") : tr("Short")}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{t.symbol}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(t.entryTime).toLocaleDateString(dateLocale, { month: "short", day: "numeric" })} · {t.market}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          t.status === "open" ? "text-muted-foreground" : pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
                        )}
                      >
                        {t.status === "open" ? tr("Open") : `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl, account.currency)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState message={t("No trades logged on this account yet.")} />
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t("Streaks & Extremes")}</h2>
            <dl className="space-y-3 text-sm">
              <Row label={t("Current streak")}>
                <span className={cn("font-semibold tabular-nums", a.currentStreak > 0 ? "text-[var(--gain)]" : a.currentStreak < 0 ? "text-[var(--loss)]" : "")}>
                  {a.currentStreak > 0 ? `${a.currentStreak}W` : a.currentStreak < 0 ? `${Math.abs(a.currentStreak)}L` : "—"}
                </span>
              </Row>
              <Row label={t("Largest win")}>
                <span className="font-semibold tabular-nums text-[var(--gain)]">{formatCurrency(a.largestWin, account.currency)}</span>
              </Row>
              <Row label={t("Largest loss")}>
                <span className="font-semibold tabular-nums text-[var(--loss)]">{formatCurrency(a.largestLoss, account.currency)}</span>
              </Row>
              <Row label={t("Avg win")}>
                <span className="font-semibold tabular-nums text-[var(--gain)]">{formatCurrency(a.avgWin, account.currency)}</span>
              </Row>
              <Row label={t("Avg loss")}>
                <span className="font-semibold tabular-nums text-[var(--loss)]">{formatCurrency(a.avgLoss, account.currency)}</span>
              </Row>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
      <TrendingUp className="size-6 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
