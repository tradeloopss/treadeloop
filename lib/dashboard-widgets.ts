// The catalogue of everything a dashboard template can show. The dashboard
// page renders strictly from these ids, and the template editor lists strictly
// from this registry, so a widget can never appear in one and not the other.

export type WidgetSection = "stat" | "panel"

export interface WidgetDef {
  id: string
  label: string
  description: string
  section: WidgetSection
  /** Panels only: how many columns of the 3-column grid the widget occupies. */
  span?: 1 | 2 | 3
}

// Top section — the compact number tiles.
export const STAT_WIDGETS: WidgetDef[] = [
  { id: "balance", label: "Account Balance", description: "Combined balance of your selected accounts", section: "stat" },
  { id: "netPnl", label: "Net P&L", description: "Total profit and loss across closed trades", section: "stat" },
  { id: "winRate", label: "Win Rate", description: "Share of closed trades that were winners", section: "stat" },
  { id: "profitFactor", label: "Profit Factor", description: "Gross profit divided by gross loss", section: "stat" },
  { id: "expectancy", label: "Expectancy", description: "Average P&L per closed trade", section: "stat" },
  { id: "totalTrades", label: "Total Trades", description: "How many trades you have closed", section: "stat" },
  { id: "avgWin", label: "Average Win", description: "Average size of a winning trade", section: "stat" },
  { id: "avgLoss", label: "Average Loss", description: "Average size of a losing trade", section: "stat" },
  { id: "largestWin", label: "Largest Win", description: "Your single best closed trade", section: "stat" },
  { id: "largestLoss", label: "Largest Loss", description: "Your single worst closed trade", section: "stat" },
  { id: "avgR", label: "Average R", description: "Mean R-multiple across trades with a stop", section: "stat" },
  { id: "maxDrawdown", label: "Max Drawdown", description: "Deepest peak-to-trough fall in equity", section: "stat" },
  { id: "currentStreak", label: "Current Streak", description: "Consecutive wins or losses right now", section: "stat" },
]

// Lower section — the charts, tables and detailed breakdowns.
export const PANEL_WIDGETS: WidgetDef[] = [
  { id: "weekCalendar", label: "This Week", description: "Daily P&L calendar for the current week", section: "panel", span: 2 },
  { id: "tradingScore", label: "Trading Score", description: "Your score across consistency, risk and discipline", section: "panel", span: 1 },
  { id: "lastWeekReport", label: "Last Week's Report", description: "How the previous week actually went", section: "panel", span: 2 },
  { id: "dailyPnlMini", label: "Daily Net Cumulative P&L", description: "Compact cumulative P&L by day", section: "panel", span: 1 },
  { id: "equityCurve", label: "Equity Curve", description: "Cumulative P&L trade by trade", section: "panel", span: 3 },
  { id: "performanceSummary", label: "Performance Summary", description: "Win/loss breakdown, hold times and more", section: "panel", span: 3 },
  { id: "recentTrades", label: "Recent Trades", description: "Your five most recent trades", section: "panel", span: 2 },
  { id: "streaks", label: "Streaks & Extremes", description: "Best and worst trades, streaks and averages", section: "panel", span: 1 },
]

export const ALL_WIDGETS: WidgetDef[] = [...STAT_WIDGETS, ...PANEL_WIDGETS]

export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(ALL_WIDGETS.map((w) => [w.id, w]))

// The top row is a fixed 5-column grid, so more than five tiles would wrap into
// a ragged second row. The lower section has no such constraint.
export const MAX_STAT_WIDGETS = 5

export const DEFAULT_STAT_WIDGETS = ["balance", "netPnl", "winRate", "profitFactor", "expectancy"]
export const DEFAULT_PANEL_WIDGETS = [
  "weekCalendar",
  "tradingScore",
  "lastWeekReport",
  "dailyPnlMini",
  "equityCurve",
  "performanceSummary",
  "recentTrades",
  "streaks",
]

// Drops ids that are no longer in the registry (a widget we removed in a later
// release) and caps the stat row, so a stored template can never render a
// broken or overflowing dashboard.
export function sanitizeLayout(statIds: unknown, panelIds: unknown): { stats: string[]; panels: string[] } {
  const clean = (value: unknown, section: WidgetSection) =>
    Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && WIDGET_BY_ID[id]?.section === section))]
      : []
  return {
    stats: clean(statIds, "stat").slice(0, MAX_STAT_WIDGETS),
    panels: clean(panelIds, "panel"),
  }
}

export interface DashboardTemplate {
  id: number
  name: string
  statWidgets: string[]
  panelWidgets: string[]
  isActive: boolean
}

// The layout a trader who has never opened the editor sees. It isn't written
// to the database — a row is only created once they actually save a template,
// so an untouched account has nothing to migrate if these defaults change.
export const DEFAULT_TEMPLATE: DashboardTemplate = {
  id: 0,
  name: "Default",
  statWidgets: DEFAULT_STAT_WIDGETS,
  panelWidgets: DEFAULT_PANEL_WIDGETS,
  isActive: true,
}
