// PNL Cards: a trader's results as a card to share, in the layout they choose
// and with exactly the things on it they choose.
//
// A card is a snapshot. Its figures are worked out once, when it is made, from
// the trader's own closed trades and account balances (lib/pnl-cards/server.ts),
// and kept with the card. What the trader changes afterwards is the layout,
// what is visible, and whether anyone else may open it.
//
// One rule runs through all of it: a thing that is switched off is not on the
// card. Not hidden by the page that draws it, but absent from what that page
// is given (redactCard). The preview, the downloaded image and the public page
// all draw the same redacted card with the same renderer, so they cannot
// disagree, and a public page cannot be made to give up what its owner hid.
//
// Pure: used by the server, the editor and the public page alike.

import { formatCurrency } from "@/lib/calc"

export const PNL_LAYOUTS = ["desktop", "mobile", "pnl-only"] as const
export type PnlCardLayout = (typeof PNL_LAYOUTS)[number]

export const LAYOUT_INFO: Record<PnlCardLayout, { label: string; description: string }> = {
  desktop: { label: "Desktop", description: "Landscape card designed for desktop screens and social sharing." },
  mobile: { label: "Mobile", description: "Portrait card designed for mobile screens and stories." },
  "pnl-only": { label: "PNL only", description: "Wide minimal card focused on your total profit." },
}

export type PnlCardVisibility = {
  profit: boolean
  balance: boolean
  totalAccounts: boolean
  accountNames: boolean
  accountPnl: boolean
  traderName: boolean
  traderPhoto: boolean
  tradeLoopLogo: boolean
  qrCode: boolean
  date: boolean
  tradingPeriod: boolean
  winRate: boolean
  numberOfTrades: boolean
  averageTrade: boolean
  bestTrade: boolean
  worstTrade: boolean
}
export type VisibilityKey = keyof PnlCardVisibility

export const DEFAULT_VISIBILITY: PnlCardVisibility = {
  profit: true,
  balance: true,
  totalAccounts: true,
  accountNames: true,
  accountPnl: true,
  traderName: true,
  traderPhoto: false,
  tradeLoopLogo: true,
  qrCode: true,
  date: true,
  tradingPeriod: false,
  winRate: false,
  numberOfTrades: false,
  averageTrade: false,
  bestTrade: false,
  worstTrade: false,
}

// In the order the editor lists them, two to a row.
export const VISIBILITY_FIELDS: { key: VisibilityKey; label: string }[] = [
  { key: "profit", label: "Profit" },
  { key: "balance", label: "Balance" },
  { key: "totalAccounts", label: "Total accounts" },
  { key: "accountNames", label: "Account names" },
  { key: "accountPnl", label: "Account P&L" },
  { key: "traderName", label: "Your name" },
  { key: "traderPhoto", label: "Your photo" },
  { key: "tradeLoopLogo", label: "TradeLoop logo" },
  { key: "qrCode", label: "QR code" },
  { key: "date", label: "Date" },
  { key: "tradingPeriod", label: "Trading period" },
  { key: "winRate", label: "Win rate" },
  { key: "numberOfTrades", label: "Number of trades" },
  { key: "averageTrade", label: "Average trade" },
  { key: "bestTrade", label: "Best trade" },
  { key: "worstTrade", label: "Worst trade" },
]

// The PNL only card is the profit and who made it. Nothing about accounts fits on it.
const PNL_ONLY: VisibilityKey[] = ["profit", "traderName", "traderPhoto", "tradeLoopLogo", "qrCode", "date", "tradingPeriod"]
export const layoutSupports = (layout: PnlCardLayout, key: VisibilityKey): boolean => layout !== "pnl-only" || PNL_ONLY.includes(key)

export type PnlCardPrivacy = "private" | "public"

export const PERIODS = ["today", "week", "month", "all"] as const
export type PnlPeriodKey = (typeof PERIODS)[number]
export const PERIOD_LABELS: Record<PnlPeriodKey, string> = { today: "Today", week: "This week", month: "This month", all: "All time" }

export type PnlCardAccount = { label: string | null; balance: number | null; pnl: number | null }
// Everything on a card. A field that is null is not on it.
export type PnlCardData = {
  scopeLabel: string
  currency: string
  profit: number | null
  // the profit as it built up over the period, trade by trade: the line behind the figure
  curve: number[] | null
  balance: number | null
  accountCount: number | null
  accounts: PnlCardAccount[]
  trader: { name: string | null; image: string | null; pro: boolean }
  period: { key: PnlPeriodKey; label: string } | null
  stats: { trades: number | null; winRate: number | null; averageTrade: number | null; bestTrade: number | null; worstTrade: number | null }
  exportedAt: string | null
}

export const cleanLayout = (raw: unknown): PnlCardLayout => (PNL_LAYOUTS as readonly unknown[]).includes(raw) ? (raw as PnlCardLayout) : "desktop"
export const cleanPeriod = (raw: unknown): PnlPeriodKey => (PERIODS as readonly unknown[]).includes(raw) ? (raw as PnlPeriodKey) : "today"
export const cleanPrivacy = (raw: unknown): PnlCardPrivacy => (raw === "public" ? "public" : "private")
// Only the known switches, only real booleans; anything else keeps what it had.
export function cleanVisibility(raw: unknown, base: PnlCardVisibility = DEFAULT_VISIBILITY): PnlCardVisibility {
  const out = { ...base }
  if (raw && typeof raw === "object") for (const { key } of VISIBILITY_FIELDS) if (typeof (raw as Record<string, unknown>)[key] === "boolean") out[key] = (raw as Record<string, boolean>)[key]
  return out
}

// What is on the card in this layout: switched on, and something the layout has room for.
export function effectiveVisibility(v: PnlCardVisibility, layout: PnlCardLayout): PnlCardVisibility {
  const out = { ...v }
  for (const { key } of VISIBILITY_FIELDS) if (!layoutSupports(layout, key)) out[key] = false
  return out
}

// The card with everything that is switched off taken out of it. Applying it twice changes nothing.
export function redactCard(data: PnlCardData, visibility: PnlCardVisibility, layout: PnlCardLayout): PnlCardData {
  const v = effectiveVisibility(visibility, layout)
  // a table with no column left is no table
  const table = v.accountNames || v.balance || v.accountPnl
  return {
    scopeLabel: data.scopeLabel,
    currency: data.currency,
    profit: v.profit ? data.profit : null,
    curve: v.profit ? data.curve : null,
    balance: v.balance ? data.balance : null,
    accountCount: v.totalAccounts ? data.accountCount : null,
    accounts: table && layout !== "pnl-only" ? data.accounts.map((a) => ({ label: v.accountNames ? a.label : null, balance: v.balance ? a.balance : null, pnl: v.accountPnl ? a.pnl : null })) : [],
    trader: { name: v.traderName ? data.trader.name : null, image: v.traderPhoto ? data.trader.image : null, pro: v.traderName && data.trader.pro },
    period: v.tradingPeriod ? data.period : null,
    stats: {
      trades: v.numberOfTrades ? data.stats.trades : null,
      winRate: v.winRate ? data.stats.winRate : null,
      averageTrade: v.averageTrade ? data.stats.averageTrade : null,
      bestTrade: v.bestTrade ? data.stats.bestTrade : null,
      worstTrade: v.worstTrade ? data.stats.worstTrade : null,
    },
    exportedAt: v.date ? data.exportedAt : null,
  }
}

// ------------------------------------------------------------------ what an account is called on a card

// An account number is never on a card in full: its last four digits, behind dots.
export const maskNumber = (login: string): string => `•••${login.replace(/\D/g, "").slice(-4) || login.slice(-4)}`
const PLATFORM: Record<string, string> = { mt5: "MT5", mt4: "MT4", rithmic: "Rithmic", tradovate: "Tradovate", tradingview: "TradingView" }
// "MT5 •••4821" for a connected account. One with no login is called what its trader called it, and
// any long run of digits in that name (an account number typed into it) is masked all the same.
export function accountLabel(a: { platform: string | null; login: string | null; name: string }): string {
  if (a.platform && a.login) return `${PLATFORM[a.platform] ?? a.platform} ${maskNumber(a.login)}`
  return a.name.replace(/\d{5,}/g, (digits) => maskNumber(digits)).slice(0, 28)
}

// ------------------------------------------------------------------ figures

const round = (n: number) => Math.round(n * 100) / 100

export type CardStats = PnlCardData["stats"] & { profit: number; curve: number[] | null }
// From the closed trades of the period, in the order they closed. No trades: no rate, no average, no best, no worst.
export function cardStats(pnls: number[]): CardStats {
  const n = pnls.length
  const profit = round(pnls.reduce((s, p) => s + p, 0))
  if (n === 0) return { profit, curve: null, trades: 0, winRate: null, averageTrade: null, bestTrade: null, worstTrade: null }
  let running = 0
  const steps = pnls.map((p) => (running = round(running + p)))
  // a line of at most forty points, the last of which is the profit itself
  const every = Math.max(1, Math.ceil(steps.length / 40))
  const curve = n < 2 ? null : [0, ...steps.filter((_, i) => i % every === every - 1 || i === steps.length - 1)]
  return {
    profit,
    curve,
    trades: n,
    winRate: Math.round((pnls.filter((p) => p > 0).length / n) * 1000) / 10,
    averageTrade: round(profit / n),
    bestTrade: round(Math.max(...pnls)),
    worstTrade: round(Math.min(...pnls)),
  }
}

// The days a period covers, as dates in the trader's own time zone. `today` is YYYY-MM-DD.
export function resolveCardPeriod(key: PnlPeriodKey, today: string): { key: PnlPeriodKey; start: string | null; end: string; label: string } {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  const full = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  const end = at(today)
  if (key === "today") return { key, start: today, end: today, label: full(end) }
  if (key === "all") return { key, start: null, end: today, label: `All time, to ${full(end)}` }
  const start = new Date(end)
  if (key === "week") start.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7))
  else start.setUTCDate(1)
  return { key, start: iso(start), end: today, label: iso(start) === today ? full(end) : `${day(start)} — ${full(end)}` }
}

// ------------------------------------------------------------------ words

export const signedMoney = (n: number, currency: string): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatCurrency(Math.abs(n), currency)}`
export const exportDate = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

// "Copy group “loop” • +$8,420.50 • Exported at Oct 8"
export function cardSubtitle(data: PnlCardData): string {
  const parts = [data.scopeLabel]
  if (data.profit != null) parts.push(signedMoney(data.profit, data.currency))
  if (data.exportedAt) parts.push(`Exported at ${new Date(data.exportedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`)
  return parts.join(" • ")
}

export const sharePath = (token: string) => `/pnl/${token}`
// What goes to X: the figure only when it is on the card, and the link to the card.
export function xShareUrl(card: { data: PnlCardData; visibility: PnlCardVisibility; layout: PnlCardLayout }, url: string): string {
  const shown = redactCard(card.data, card.visibility, card.layout)
  const text = shown.profit != null ? `My TradeLoop trading results:\n${signedMoney(shown.profit, shown.currency)} PNL` : "My TradeLoop trading results"
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}
export const cardFileName = (iso: string | null) => `tradeloop-pnl-card-${(iso ?? new Date().toISOString()).slice(0, 10)}.png`

// ------------------------------------------------------------------ what the pages are given

// The owner's card, with everything on it: what they edit.
export type PnlCardView = { id: number; token: string; layout: PnlCardLayout; visibility: PnlCardVisibility; privacy: PnlCardPrivacy; data: PnlCardData; createdAt: string; updatedAt: string }
// A card in the owner's list.
export type PnlCardSummary = { id: number; token: string; layout: PnlCardLayout; privacy: PnlCardPrivacy; scopeLabel: string; createdAt: string }
// A card as anyone else is given it: already redacted, and with nothing that says whose it is beyond what is on it.
export type PublicPnlCard = { token: string; layout: PnlCardLayout; visibility: PnlCardVisibility; data: PnlCardData }
export function publicCard(card: { token: string; layout: PnlCardLayout; visibility: PnlCardVisibility; data: PnlCardData }): PublicPnlCard {
  return { token: card.token, layout: card.layout, visibility: effectiveVisibility(card.visibility, card.layout), data: redactCard(card.data, card.visibility, card.layout) }
}

// Which accounts a card is of. The server works the accounts out from it: none of this is trusted as it comes.
export type PnlCardScope = { kind: "copy_group"; groupId: number } | { kind: "accounts"; accountIds: number[] } | { kind: "all" }
