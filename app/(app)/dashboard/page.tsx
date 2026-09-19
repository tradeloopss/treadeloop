import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getTrades } from "@/app/actions/trades"
import { getAccounts, getActiveAccountIds } from "@/app/actions/accounts"
import { getJournalEntries } from "@/app/actions/journal"
import { getRecentSyncEvents } from "@/app/actions/sync-events"
import { AutoSyncBanner } from "@/components/auto-sync-banner"
import { isPro } from "@/lib/subscription"
import { analyze, formatCurrency, type TradeStat } from "@/lib/calc"
import { computeDayPnl } from "@/lib/day-pnl"
import { computeDailyAccountPnl, computeAccountPnlInRange } from "@/lib/daily-account-pnl"
import { resolvePnlPeriod } from "@/lib/pnl-period"
import type { BrokerBreakdown } from "@/app/actions/daily-pnl-share"
import { PnlCertificateButton } from "@/components/pnl-certificate-button"
import { CurrentWeekCalendar } from "@/components/current-week-calendar"
import { LastWeekReport } from "@/components/last-week-report"
import type { ReportTrade } from "@/components/period-insights"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EquityCurve, type EquityPoint } from "@/components/equity-curve"
import { TradingScore } from "@/components/trading-score"
import { computeTradingScore } from "@/lib/trading-score"
import { DailyPnlMini, type DailyPnlPoint } from "@/components/daily-pnl-mini"
import { PerformanceSummaryCard } from "@/components/performance-summary"
import { computePerformanceSummary } from "@/lib/performance-summary"
import { AccountCustomizer } from "@/components/account-customizer"
import { Suspense } from "react"
import { DashboardCanvas } from "@/components/dashboard-canvas"
import { DashboardTemplateMenu } from "@/components/dashboard-template-menu"
import { getActiveTemplate, getTemplates } from "@/app/actions/dashboard-templates"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DollarSign, Percent, Scale, Activity, TrendingUp, ArrowRight, Wallet } from "lucide-react"
import { recordRequestTiming } from "@/lib/telemetry"

export default async function DashboardPage() {
  const startedAt = Date.now()
  const session = await auth.api.getSession({ headers: await headers() })
  const [rows, accounts, activeAccountIds, journalEntries, pro, syncEvents, templates, template] = await Promise.all([
    getTrades(),
    getAccounts(),
    getActiveAccountIds(),
    getJournalEntries(),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
    getRecentSyncEvents(),
    getTemplates(),
    getActiveTemplate(),
  ])
  const dayPnlByDay = computeDayPnl(rows, journalEntries)

  const today = new Date().toISOString().slice(0, 10)
  const dailyByAccount = computeDailyAccountPnl(rows, today)
  const dailyAccountRows = accounts.map((acc) => {
    const day = dailyByAccount.get(acc.id)
    return {
      id: acc.id,
      name: acc.name,
      currency: acc.currency,
      startingBalance: Number(acc.startingBalance),
      pnl: day?.pnl ?? 0,
      trades: day?.trades ?? 0,
      wins: day?.wins ?? 0,
      losses: day?.losses ?? 0,
    }
  })

  const allAccountsBreakdown: BrokerBreakdown[] = (() => {
    const map = new Map<string, BrokerBreakdown>()
    for (const acc of accounts) {
      const day = dailyByAccount.get(acc.id)
      const key = acc.broker?.trim() || "Other"
      const existing = map.get(key) ?? { broker: key, pnl: 0, accounts: 0 }
      existing.pnl += day?.pnl ?? 0
      existing.accounts += 1
      map.set(key, existing)
    }
    return [...map.values()].sort((x, y) => y.pnl - x.pnl)
  })()
  const allAccountsPnl = dailyAccountRows.reduce((sum, r) => sum + r.pnl, 0)

  // Same shapes over the current Monday–Sunday week, so the certificate's
  // "Weekly" option has real numbers rather than reusing today's.
  const week = resolvePnlPeriod("weekly", today)
  const weeklyByAccount = computeAccountPnlInRange(rows, week.start, week.end)
  const weeklyAccountRows = accounts.map((acc) => {
    const period = weeklyByAccount.get(acc.id)
    return {
      id: acc.id,
      name: acc.name,
      currency: acc.currency,
      startingBalance: Number(acc.startingBalance),
      pnl: period?.pnl ?? 0,
      trades: period?.trades ?? 0,
      wins: period?.wins ?? 0,
      losses: period?.losses ?? 0,
    }
  })
  const weeklyBreakdown: BrokerBreakdown[] = (() => {
    const map = new Map<string, BrokerBreakdown>()
    for (const acc of accounts) {
      const period = weeklyByAccount.get(acc.id)
      const key = acc.broker?.trim() || "Other"
      const existing = map.get(key) ?? { broker: key, pnl: 0, accounts: 0 }
      existing.pnl += period?.pnl ?? 0
      existing.accounts += 1
      map.set(key, existing)
    }
    return [...map.values()].sort((x, y) => y.pnl - x.pnl)
  })()
  const weeklyPnl = weeklyAccountRows.reduce((sum, r) => sum + r.pnl, 0)

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

  // Build cumulative equity curve from closed trades, oldest to newest.
  const closed = rows
    .filter((t) => t.status === "closed")
    .sort(
      (x, y) =>
        new Date(x.exitTime ?? x.entryTime).getTime() - new Date(y.exitTime ?? y.entryTime).getTime(),
    )
  let running = 0
  const equity: EquityPoint[] = [{ label: "Start", equity: 0 }]
  for (const t of closed) {
    running += Number(t.pnl)
    equity.push({
      label: new Date(t.exitTime ?? t.entryTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      equity: Number(running.toFixed(2)),
    })
  }

  // Group closed trades by calendar day for the compact "Daily net cumulative
  // P&L" sidebar chart (distinct from the trade-by-trade Equity Curve).
  const pnlByDay = new Map<string, number>()
  for (const t of closed) {
    const day = new Date(t.exitTime ?? t.entryTime).toISOString().slice(0, 10)
    pnlByDay.set(day, (pnlByDay.get(day) ?? 0) + Number(t.pnl))
  }
  let dailyRunning = 0
  const dailyPnl: DailyPnlPoint[] = Array.from(pnlByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, pnl]) => {
      dailyRunning += pnl
      return {
        label: new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        cumulative: Number(dailyRunning.toFixed(2)),
      }
    })

  const recent = rows.slice(0, 5)
  const pf = Number.isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : "∞"
  const tradingScore = computeTradingScore(stats)
  const performanceSummary = computePerformanceSummary(stats)

  // Balance prefers the broker-reported currentBalance (kept fresh by
  // MetaTrader sync) over starting balance + imported P&L, since the latter
  // only reflects trades this app actually knows about — a connected
  // account's real balance also includes deposits, withdrawals, and any
  // trading the import window didn't cover.
  const pnlByAccount = new Map<number, number>()
  let unassignedPnl = 0
  for (const t of rows) {
    if (t.status !== "closed") continue
    if (t.accountId == null) {
      unassignedPnl += Number(t.pnl)
    } else {
      pnlByAccount.set(t.accountId, (pnlByAccount.get(t.accountId) ?? 0) + Number(t.pnl))
    }
  }
  function accountBalance(acc: (typeof accounts)[number]) {
    if (acc.currentBalance != null) return Number(acc.currentBalance)
    return Number(acc.startingBalance) + (pnlByAccount.get(acc.id) ?? 0)
  }

  const selectedAccounts = activeAccountIds != null ? accounts.filter((acc) => activeAccountIds.includes(acc.id)) : accounts
  const balance = selectedAccounts.reduce((sum, acc) => sum + accountBalance(acc), 0) + unassignedPnl
  const balanceCurrency = selectedAccounts.length === 1 ? selectedAccounts[0].currency : (accounts[0]?.currency ?? "USD")
  const balanceSub =
    selectedAccounts.length === 1
      ? selectedAccounts[0].name
      : accounts.length > 0
        ? `${selectedAccounts.length} account${selectedAccounts.length === 1 ? "" : "s"} combined`
        : "No account set up yet"

  // Every widget the registry knows about, built once and then rendered in
  // whatever order the active template asks for.
  const statWidgets: Record<string, React.ReactNode> = {
    balance: <StatCard label="Account Balance" value={formatCurrency(balance, balanceCurrency)} sub={balanceSub} icon={<Wallet className="size-4" />} />,
    netPnl: (
      <StatCard
        label="Net P&L"
        value={formatCurrency(a.netPnl)}
        tone={a.netPnl > 0 ? "gain" : a.netPnl < 0 ? "loss" : "neutral"}
        sub={`${a.totalTrades} closed trade${a.totalTrades === 1 ? "" : "s"}`}
        icon={<DollarSign className="size-4" />}
      />
    ),
    winRate: <StatCard label="Win Rate" value={`${a.winRate.toFixed(1)}%`} sub={`${a.wins}W / ${a.losses}L`} icon={<Percent className="size-4" />} />,
    profitFactor: <StatCard label="Profit Factor" value={pf} sub="Gross profit ÷ gross loss" icon={<Scale className="size-4" />} />,
    expectancy: (
      <StatCard
        label="Expectancy"
        value={formatCurrency(a.expectancy)}
        tone={a.expectancy > 0 ? "gain" : a.expectancy < 0 ? "loss" : "neutral"}
        sub="Avg P&L per trade"
        icon={<Activity className="size-4" />}
      />
    ),
    totalTrades: <StatCard label="Total Trades" value={a.totalTrades} sub="Closed trades" icon={<Activity className="size-4" />} />,
    avgWin: <StatCard label="Average Win" value={formatCurrency(a.avgWin)} tone="gain" sub="Per winning trade" icon={<TrendingUp className="size-4" />} />,
    avgLoss: <StatCard label="Average Loss" value={formatCurrency(a.avgLoss)} tone="loss" sub="Per losing trade" icon={<TrendingUp className="size-4" />} />,
    largestWin: <StatCard label="Largest Win" value={formatCurrency(a.largestWin)} tone="gain" sub="Best closed trade" icon={<TrendingUp className="size-4" />} />,
    largestLoss: <StatCard label="Largest Loss" value={formatCurrency(a.largestLoss)} tone="loss" sub="Worst closed trade" icon={<TrendingUp className="size-4" />} />,
    avgR: <StatCard label="Average R" value={a.avgRMultiple.toFixed(2)} sub="Mean R-multiple" icon={<Scale className="size-4" />} />,
    maxDrawdown: <StatCard label="Max Drawdown" value={formatCurrency(-a.maxDrawdown)} tone={a.maxDrawdown > 0 ? "loss" : "neutral"} sub="Peak to trough" icon={<Activity className="size-4" />} />,
    currentStreak: (
      <StatCard
        label="Current Streak"
        value={a.currentStreak > 0 ? `${a.currentStreak}W` : a.currentStreak < 0 ? `${Math.abs(a.currentStreak)}L` : "—"}
        tone={a.currentStreak > 0 ? "gain" : a.currentStreak < 0 ? "loss" : "neutral"}
        sub="Consecutive results"
        icon={<Activity className="size-4" />}
      />
    ),
  }

  const panelWidgets: Record<string, React.ReactNode> = {
    weekCalendar: <CurrentWeekCalendar byDay={dayPnlByDay} />,
    tradingScore: <TradingScore overall={tradingScore.overall} axes={tradingScore.axes} />,
    lastWeekReport: <LastWeekReport trades={reportTrades} />,
    dailyPnlMini: <DailyPnlMini data={dailyPnl} />,
    equityCurve: (
      <Card className="h-full p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">Equity Curve</h2>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(a.netPnl)}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Max DD {formatCurrency(-a.maxDrawdown)}</span>
            <span>Avg R {a.avgRMultiple.toFixed(2)}</span>
          </div>
        </div>
        {equity.length > 1 ? <EquityCurve data={equity} /> : <EmptyState message="Log your first closed trade to see your equity curve." />}
      </Card>
    ),
    performanceSummary: <PerformanceSummaryCard summary={performanceSummary} />,
    recentTrades: (
      <Card className="h-full p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Recent Trades</h2>
          <Link href="/trades" className="text-xs font-medium text-primary hover:underline">
            View all
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
                      {t.side}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{t.symbol}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(t.entryTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {t.market}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      t.status === "open" ? "text-muted-foreground" : pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
                    )}
                  >
                    {t.status === "open" ? "Open" : `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}`}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState message="No trades yet." />
        )}
      </Card>
    ),
    streaks: (
      <Card className="h-full p-5">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Streaks & Extremes</h2>
        <dl className="space-y-3 text-sm">
          <Row label="Current streak">
            <span className={cn("font-semibold tabular-nums", a.currentStreak > 0 ? "text-[var(--gain)]" : a.currentStreak < 0 ? "text-[var(--loss)]" : "")}>
              {a.currentStreak > 0 ? `${a.currentStreak}W` : a.currentStreak < 0 ? `${Math.abs(a.currentStreak)}L` : "—"}
            </span>
          </Row>
          <Row label="Largest win">
            <span className="font-semibold tabular-nums text-[var(--gain)]">{formatCurrency(a.largestWin)}</span>
          </Row>
          <Row label="Largest loss">
            <span className="font-semibold tabular-nums text-[var(--loss)]">{formatCurrency(a.largestLoss)}</span>
          </Row>
          <Row label="Avg win">
            <span className="font-semibold tabular-nums text-[var(--gain)]">{formatCurrency(a.avgWin)}</span>
          </Row>
          <Row label="Avg loss">
            <span className="font-semibold tabular-nums text-[var(--loss)]">{formatCurrency(a.avgLoss)}</span>
          </Row>
        </dl>
      </Card>
    ),
  }

  void recordRequestTiming("/dashboard", Date.now() - startedAt)
  return (
    <div>
      <AutoSyncBanner events={syncEvents} />
      <PageHeader
        title="Dashboard"
        description="Your trading performance at a glance"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AccountCustomizer
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              activeAccountIds={activeAccountIds}
            />
            <DashboardTemplateMenu templates={templates} active={template} />
            <PnlCertificateButton
              accounts={dailyAccountRows}
              weeklyAccounts={weeklyAccountRows}
              allAccounts={{
                pnl: allAccountsPnl,
                breakdown: allAccountsBreakdown,
                currency: accounts[0]?.currency ?? "USD",
                accountCount: accounts.length,
              }}
              allAccountsWeekly={{
                pnl: weeklyPnl,
                breakdown: weeklyBreakdown,
                currency: accounts[0]?.currency ?? "USD",
                accountCount: accounts.length,
              }}
              date={today}
              traderName={session?.user.name ?? "Trader"}
              traderImage={session?.user.image}
              isPro={pro}
            />
            <Button
              nativeButton={false}
              render={
                <Link href="/trades">
                  Log a trade <ArrowRight className="size-4" />
                </Link>
              }
            />
          </div>
        }
      />

      <div className="p-4 sm:p-6">
        <Suspense fallback={null}>
          <DashboardCanvas template={template} statNodes={statWidgets} panelNodes={panelWidgets} />
        </Suspense>
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
