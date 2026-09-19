import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getTrades } from "@/app/actions/trades"
import { getAccounts, getActiveAccountIds, getManualEntryLockedAccountIds } from "@/app/actions/accounts"
import { getPlaybooks } from "@/app/actions/playbooks"
import { formatCurrency } from "@/lib/calc"
import { analyzeBiggestLoss } from "@/lib/loss-analysis"
import { PageHeader } from "@/components/page-header"
import { AddTradeDialog } from "@/components/add-trade-dialog"
import { TradesTable, type TradeRow } from "@/components/trades-table"
import { StatCard } from "@/components/stat-card"
import { BiggestLossAnalysis } from "@/components/biggest-loss-analysis"
import { AccountCustomizer } from "@/components/account-customizer"
import { recordRequestTiming } from "@/lib/telemetry"
import { getT } from "@/lib/i18n/server"

export default async function TradesPage() {
  const startedAt = Date.now()
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [rows, accounts, activeAccountIds, playbooks, lockedAccountIds] = await Promise.all([
    getTrades(),
    getAccounts(),
    getActiveAccountIds(),
    getPlaybooks(),
    getManualEntryLockedAccountIds(),
  ])

  // Prop firm / live-synced accounts are import-only, so they're not offered
  // for manual entry (enforced again server-side in createTrade).
  const manualEntryAccounts = accounts.filter((a) => !lockedAccountIds.includes(a.id))

  const trades: TradeRow[] = rows.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    market: t.market,
    side: t.side,
    status: t.status,
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    pnl: t.pnl,
    fees: t.fees,
    rMultiple: t.rMultiple,
    entryTime: typeof t.entryTime === "string" ? t.entryTime : t.entryTime.toISOString(),
    exitTime: t.exitTime == null ? null : typeof t.exitTime === "string" ? t.exitTime : t.exitTime.toISOString(),
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    tags: t.tags,
    notes: t.notes,
    externalId: t.externalId,
  }))

  const closed = rows.filter((t) => t.status === "closed")
  const wins = closed.filter((t) => Number(t.pnl) > 0).length
  const losses = closed.filter((t) => Number(t.pnl) < 0).length
  const breakevens = closed.filter((t) => Number(t.pnl) === 0).length
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.pnl), 0)

  const winAmounts = closed.filter((t) => Number(t.pnl) > 0).map((t) => Number(t.pnl))
  const lossAmounts = closed.filter((t) => Number(t.pnl) < 0).map((t) => Number(t.pnl))
  const bigWin = winAmounts.length ? Math.max(...winAmounts) : 0
  const bigLoss = lossAmounts.length ? Math.min(...lossAmounts) : 0
  const avgLoss = lossAmounts.length ? lossAmounts.reduce((a, b) => a + b, 0) / lossAmounts.length : 0
  const lossAnalysis = analyzeBiggestLoss(rows, avgLoss, t)

  void recordRequestTiming("/trades", Date.now() - startedAt)
  return (
    <div>
      <PageHeader
        title={t("Trades")}
        description={trades.length === 1 ? t("1 trade logged") : t("{n} trades logged", { n: trades.length })}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AccountCustomizer accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} activeAccountIds={activeAccountIds} />
            <AddTradeDialog
              accounts={manualEntryAccounts.map((a) => ({ id: a.id, name: a.name }))}
              playbooks={playbooks.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
        }
      />
      <div className="space-y-4 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label={t("Total Trades")} value={rows.length} />
          <StatCard label={t("Wins")} value={wins} tone="gain" />
          <StatCard label={t("Losses")} value={losses} tone="loss" />
          <StatCard label={t("Breakevens")} value={breakevens} />
          <StatCard
            label={t("Total P&L")}
            value={`${totalPnl >= 0 ? "+" : ""}${formatCurrency(totalPnl)}`}
            tone={totalPnl > 0 ? "gain" : totalPnl < 0 ? "loss" : "neutral"}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label={t("Big Win")} value={formatCurrency(bigWin)} tone="gain" />
          <StatCard label={t("Big Loss")} value={formatCurrency(bigLoss)} tone="loss" />
        </div>

        {lossAnalysis && <BiggestLossAnalysis result={lossAnalysis} />}

        <TradesTable trades={trades} traderName={session?.user.name} traderImage={session?.user.image} />
      </div>
    </div>
  )
}
