"use client"

import { useState } from "react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { formatCurrency, formatCompact } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { StatCard } from "@/components/stat-card"
import type { PropFirmDashboardData, FirmBreakdown } from "@/lib/propfirm-dashboard"
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react"
import { useT } from "@/components/locale-provider"

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

function PillTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function TextTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "-mb-px border-b-2 pb-2 font-medium transition-colors",
            value === o.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PassBar({ label, passed, attempted }: { label: string; passed: number; attempted: number }) {
  const t = useT()
  const pct = attempted > 0 ? (passed / attempted) * 100 : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {passed}/{attempted} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[var(--gain)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("Passed {passed} out of {attempted} accounts", { passed, attempted })}
      </p>
    </div>
  )
}

function FinanceRow({ item, currency, color }: { item: FirmBreakdown; currency: string; color: string }) {
  const t = useT()
  const total = item.spent + item.earned
  const earnedPct = total > 0 ? (item.earned / total) * 100 : 0
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <span className="size-2 rounded-full" style={{ background: color }} />
          {t(item.key)}
        </span>
        <span className={cn("font-semibold tabular-nums", item.net >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
          {item.net >= 0 ? "+" : ""}
          {formatCurrency(item.net, currency)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("Spent {spent} · Earned {earned}", { spent: formatCurrency(item.spent, currency), earned: formatCurrency(item.earned, currency) })}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[var(--gain)]" style={{ width: `${earnedPct}%` }} />
      </div>
    </li>
  )
}

function rangeStart(range: "1w" | "1m" | "1y"): Date {
  const d = new Date()
  if (range === "1w") d.setDate(d.getDate() - 7)
  else if (range === "1m") d.setMonth(d.getMonth() - 1)
  else d.setFullYear(d.getFullYear() - 1)
  return d
}

export function PropFirmDashboard({ data, currency }: { data: PropFirmDashboardData; currency: string }) {
  const t = useT()
  const [chartRange, setChartRange] = useState<"1w" | "1m" | "1y">("1y")
  const [passTab, setPassTab] = useState<"firm" | "planType" | "size">("firm")
  const [financeTab, setFinanceTab] = useState<"firm" | "type" | "size" | "expenses">("firm")
  const [breachTab, setBreachTab] = useState<"evaluation" | "funded">("evaluation")

  const passInsights = passTab === "firm" ? data.passRateByFirm : passTab === "planType" ? data.passRateByPlanType : data.passRateBySize

  const chartStart = rangeStart(chartRange)
  const chartData = data.roiSeries.filter((p) => new Date(p.date) >= chartStart)

  const financeItems = financeTab === "firm" ? data.byFirm : financeTab === "type" ? data.byAccountType : data.byAccountSize
  const financeTotalNet = financeItems.reduce((sum, f) => sum + f.net, 0)
  const totalExpenses = data.expenseBreakdown.reduce((sum, e) => sum + e.amount, 0)

  const financePieData =
    financeTab === "expenses"
      ? data.expenseBreakdown.map((e, i) => ({ name: t(e.key), value: e.amount, color: CHART_COLORS[i % CHART_COLORS.length] }))
      : financeItems.map((f) => ({ name: t(f.key), value: Math.abs(f.net), color: f.net >= 0 ? "var(--gain)" : "var(--loss)" }))

  const financeCenterLabel =
    financeTab === "firm" ? t("Net by firm") : financeTab === "type" ? t("Net by account type") : financeTab === "size" ? t("Net by account size") : t("Total expenses")
  const financeCenterValue = financeTab === "expenses" ? formatCurrency(totalExpenses, currency) : `${financeTotalNet >= 0 ? "+" : ""}${formatCurrency(financeTotalNet, currency)}`

  const breachBucket = data.breachByPhase[breachTab]

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-[var(--gain)]" /> {t("Funded")}
              </div>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.fundedBalance, currency)}</p>
              <p className="text-xs text-muted-foreground">{data.fundedCount === 1 ? t("1 funded account") : t("{n} funded accounts", { n: data.fundedCount })}</p>
            </div>
            <div className="border-t pt-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-[var(--chart-1)]" /> {t("Evaluation")}
              </div>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.evaluationBalance, currency)}</p>
              <p className="text-xs text-muted-foreground">{data.evaluationCount === 1 ? t("1 eval account") : t("{n} eval accounts", { n: data.evaluationCount })}</p>
            </div>
          </div>
        </Card>
        <StatCard label={t("Total spent")} value={formatCurrency(data.totalSpent, currency)} sub={t("Evaluation fees & resets")} icon={<DollarSign className="size-4" />} />
        <StatCard label={t("Total earned")} value={formatCurrency(data.totalEarned, currency)} sub={t("Payouts received")} tone="gain" icon={<TrendingUp className="size-4" />} />
        <StatCard
          label={t("Net total")}
          value={`${data.netTotal >= 0 ? "+" : ""}${formatCurrency(data.netTotal, currency)}`}
          sub={data.roiPct != null ? t("{pct}% ROI", { pct: `${data.roiPct >= 0 ? "+" : ""}${data.roiPct.toFixed(1)}` }) : t("No spend logged yet")}
          tone={data.netTotal >= 0 ? "gain" : "loss"}
          icon={data.netTotal >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">{t("ROI progression")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("Track how your cumulative net return on investment evolves over time")}</p>
          </div>
          <PillTabs
            value={chartRange}
            onChange={setChartRange}
            options={[
              { value: "1w", label: "1W" },
              { value: "1m", label: "1M" },
              { value: "1y", label: "1Y" },
            ]}
          />
        </div>
        {chartData.length > 1 ? (
          <div className="mt-4 h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="earnedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--gain)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--gain)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="spentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--loss)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--loss)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => formatCompact(Number(v))} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                  formatter={(value, name) => [
                    formatCurrency(typeof value === "number" ? value : 0, currency),
                    name === "cumulativeEarned" ? t("Income") : name === "cumulativeSpent" ? t("Expenses") : t("Return on investment"),
                  ]}
                />
                <Area type="monotone" dataKey="cumulativeEarned" stroke="var(--gain)" strokeWidth={2} fill="url(#earnedFill)" />
                <Area type="monotone" dataKey="cumulativeSpent" stroke="var(--loss)" strokeWidth={2} fill="url(#spentFill)" />
                <Area type="monotone" dataKey="cumulativeNet" stroke="var(--primary)" strokeWidth={2} fill="url(#netFill)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--gain)]" /> {t("Income")}</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--primary)]" /> {t("Return on investment")}</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--loss)]" /> {t("Expenses")}</span>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("Log at least two fees or payouts to see this chart build up.")}</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-medium">{t("Finance breakdown")}</h2>
            <TextTabs
              value={financeTab}
              onChange={setFinanceTab}
              options={[
                { value: "firm", label: t("By firm") },
                { value: "type", label: t("By account type") },
                { value: "size", label: t("By account size") },
                { value: "expenses", label: t("Expenses") },
              ]}
            />
          </div>
          {financePieData.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Log a cost or payout on an account to see this.")}</p>
          ) : (
            <>
              <div className="relative mx-auto h-[180px] w-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={financePieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={75} paddingAngle={2} strokeWidth={0}>
                      {financePieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                      formatter={(value) => formatCurrency(typeof value === "number" ? value : 0, currency)}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{financeCenterLabel}</p>
                  <p className={cn("text-sm font-semibold tabular-nums", financeTab !== "expenses" && (financeTotalNet >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]"))}>
                    {financeCenterValue}
                  </p>
                </div>
              </div>
              <ul className="space-y-2">
                {financeTab === "expenses"
                  ? data.expenseBreakdown.map((e, i) => {
                      const pct = totalExpenses > 0 ? (e.amount / totalExpenses) * 100 : 0
                      return (
                        <li key={e.key} className="rounded-md border p-3">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 font-medium">
                              <span className="size-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                              {t(e.key)}
                            </span>
                            <span className="font-semibold tabular-nums">{formatCurrency(e.amount, currency)}</span>
                          </div>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          </div>
                        </li>
                      )
                    })
                  : financeItems.map((f) => (
                      <FinanceRow key={f.key} item={f} currency={currency} color={f.net >= 0 ? "var(--gain)" : "var(--loss)"} />
                    ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-medium">{t("Passing insights")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("Understand your passing rates across different dimensions")}</p>
            <TextTabs
              value={passTab}
              onChange={setPassTab}
              options={[
                { value: "firm", label: t("By firm") },
                { value: "planType", label: t("By account type") },
                { value: "size", label: t("By account size") },
              ]}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("Passing rate = accounts passed / accounts attempted")}</p>
          {passInsights.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No resolved accounts yet (passed or breached).")}</p>
          ) : (
            <div className="space-y-4">
              {passInsights.map((p) => (
                <PassBar key={p.key} label={t(p.key)} passed={p.passed} attempted={p.attempted} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-medium">{t("Breach insights")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("Understand why your accounts get breached and spot patterns")}</p>
          <TextTabs
            value={breachTab}
            onChange={setBreachTab}
            options={[
              { value: "evaluation", label: t("Evaluation Breaches ({n})", { n: data.breachByPhase.evaluation.count }) },
              { value: "funded", label: t("Funded Breaches ({n})", { n: data.breachByPhase.funded.count }) },
            ]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Top breach reasons")}</p>
            {breachBucket.reasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("When marking an account as breached, select a reason and it will appear here.")}</p>
            ) : (
              <ul className="space-y-1.5">
                {breachBucket.reasons.map((r) => (
                  <li key={r.reason} className="flex items-center justify-between text-sm">
                    <span>{t(r.reason)}</span>
                    <span className="font-medium tabular-nums text-muted-foreground">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Correlated metrics")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t("Avg days before breach")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{breachBucket.avgDaysBeforeBreach != null ? t("{n}d", { n: breachBucket.avgDaysBeforeBreach.toFixed(0) }) : "—"}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t("Avg P&L before breach")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--loss)]">
                  {breachBucket.avgPnlBeforeBreach != null ? formatCurrency(breachBucket.avgPnlBeforeBreach, currency) : "—"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t("Most common size")}</p>
                <p className="mt-1 text-lg font-semibold">{breachBucket.mostCommonSize ?? "—"}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t("Most common firm")}</p>
                <p className="mt-1 text-lg font-semibold">{breachBucket.mostCommonFirm ? t(breachBucket.mostCommonFirm) : "—"}</p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
