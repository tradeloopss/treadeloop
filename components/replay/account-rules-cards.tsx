"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Panel, PanelHead, ProgressRow, StatusPill, Metric } from "@/components/replay/shared"
import { fmtMoney, fmtSigned } from "@/lib/replay/calc"
import type { AccountState, ReplayAccount, RuleProgress, RuleStatus } from "@/lib/replay/types"

export function ReplayAccountCard({
  account,
  accounts,
  onSelect,
  state,
}: {
  account: ReplayAccount
  accounts: ReplayAccount[]
  onSelect: (id: string) => void
  state: AccountState
}) {
  return (
    <Panel>
      <PanelHead
        title="Replay Account"
        action={
          <Select value={account.id} onValueChange={(v) => v && onSelect(v)}>
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{account.name}</p>
            <p className="text-xs text-muted-foreground">{account.platform}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gain)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gain)]">
            <span className="size-1.5 rounded-full bg-[var(--gain)]" /> Connected
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
          <Metric label="Balance" value={fmtMoney(state.balance, account.currency)} />
          <Metric label="Equity" value={fmtMoney(state.equity, account.currency)} />
          <Metric label="Today's P&L" value={fmtSigned(state.todayPnl)} tone={state.todayPnl >= 0 ? "gain" : "loss"} />
          <Metric label="Open Risk" value={state.openRisk > 0 ? fmtSigned(-state.openRisk) : "$0.00"} tone={state.openRisk > 0 ? "loss" : "neutral"} />
          <Metric label="Open Trades" value={String(state.openTrades)} />
        </div>
      </div>
    </Panel>
  )
}

export function PropFirmRulesCard({ account, rows, overall }: { account: ReplayAccount; rows: RuleProgress[]; overall: RuleStatus }) {
  const noRules = rows.length === 0
  const rowText = (r: RuleProgress) =>
    r.label === "Trading Days"
      ? `${r.used} / ${r.limit}`
      : `${fmtMoney(r.used, account.currency)} / ${r.limit != null ? fmtMoney(r.limit, account.currency) : "—"}`

  return (
    <Panel>
      <PanelHead
        title="Prop Firm Rules"
        action={
          <Link href="/propfirm-max" className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
            View rules <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{account.firm}</p>
          {!noRules && <StatusPill status={overall} />}
        </div>
        {noRules ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
            Practice account — no prop-firm limits. Switch to a funded account to replay against its rules.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <ProgressRow key={r.label} label={r.label} text={rowText(r)} pct={r.pct} status={r.status} />
            ))}
            <div className="flex items-center gap-1.5 border-t pt-2 text-xs">
              <StatusPill status={overall} />
              <span className="text-muted-foreground">
                {overall === "breach" ? "Rule breach — an open position exceeds a limit." : overall === "warning" ? "Approaching a limit — trade carefully." : "Within account limits."}
              </span>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
