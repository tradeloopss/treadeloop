import Papa from "papaparse"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { importEvents, trades, tradingAccounts } from "@/lib/db/schema"
import { isTradovateCsv, parseTradovateOrdersCsv, reconstructTrades } from "@/lib/tradovate-csv"
import { isNinjaTraderCsv, parseNinjaTraderTradesCsv } from "@/lib/ninjatrader-csv"
import { isMetaTraderReport, parseMetaTraderReport } from "@/lib/metatrader-report"
import { isTradingViewCsv, parseTradingViewCsv } from "@/lib/tradingview-csv"
import { reconstructTrades as reconstructFills } from "@/lib/fill-reconstruction"
import type { ImportedTrade } from "@/lib/trade-import"
import { computePnl, contractMultiplierForSymbol } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"

export type ImportResult = { source: string; imported: number; duplicates: number; skippedRows: number; totalRows: number }

// The name TradingView fills are grouped under. With no account chosen it's
// the one an import would create anyway, so both cases agree.
export const TRADINGVIEW_DEFAULT_ACCOUNT = "TradingView Paper"

async function tradingViewAccountName(userId: string, fixedAccountId: number | null): Promise<string> {
  if (fixedAccountId == null) return TRADINGVIEW_DEFAULT_ACCOUNT
  const [account] = await db
    .select({ name: tradingAccounts.name })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, fixedAccountId), eq(tradingAccounts.userId, userId)))
  return account?.name ?? TRADINGVIEW_DEFAULT_ACCOUNT
}

// Which parser a file belongs to, without parsing it — for logging failures.
export function detectSource(csvText: string): string | null {
  const headerRow = Papa.parse<string[]>(csvText, { preview: 1 }).data[0] ?? []
  if (isTradovateCsv(headerRow)) return "Tradovate"
  if (isNinjaTraderCsv(headerRow)) return "NinjaTrader"
  if (isTradingViewCsv(headerRow)) return "TradingView"
  if (isMetaTraderReport(csvText)) return "MetaTrader"
  return null
}

// Parses a broker export and inserts its trades for the user. Throws with a
// message meant for the user when the file can't be imported. Shared by the
// user's upload (app/actions/broker.ts) and an admin re-run of a failed one.
export async function importCsvText(
  userId: string,
  csvText: string,
  fixedAccountId: number | null,
  // Applied as the starting balance to any account this import creates (auto
  // mode). Existing accounts keep the balance they already have. Null/0 leaves
  // a new account at 0, where its balance is just the sum of its trades' P&L.
  newAccountStartingBalance: number | null = null,
): Promise<ImportResult> {
  if (fixedAccountId != null) {
    const [owned] = await db
      .select()
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.id, fixedAccountId), eq(tradingAccounts.userId, userId)))
    if (!owned) throw new Error("That account no longer exists")
  }

  // Tradovate's own export can occasionally fail client-side and download a
  // near-empty file containing just the text "undefined" — catch that with a
  // clear message instead of the generic unrecognized-format error below.
  if (csvText.trim().length < 20) {
    throw new Error("That file looks empty or broken — try exporting again from the broker's report page")
  }

  const headerRow = Papa.parse<string[]>(csvText, { preview: 1 }).data[0] ?? []

  let imported: ImportedTrade[]
  let totalRows: number
  let skippedRows: number
  let source: string
  let market: "futures" | "forex"

  if (isTradovateCsv(headerRow)) {
    const parsed = parseTradovateOrdersCsv(csvText)
    imported = reconstructTrades(parsed.fills)
    totalRows = parsed.totalRows
    skippedRows = parsed.skippedRows
    source = "Tradovate"
    market = "futures"
  } else if (isNinjaTraderCsv(headerRow)) {
    const parsed = parseNinjaTraderTradesCsv(csvText)
    imported = parsed.trades
    totalRows = parsed.totalRows
    skippedRows = parsed.skippedRows
    source = "NinjaTrader"
    market = "futures"
  } else if (isTradingViewCsv(headerRow)) {
    // Keyed on the account the rows are going into, so the same history
    // pasted (app/actions/tradingview.ts) and uploaded here produces the
    // same trade ids and dedupes across both routes.
    const parsed = parseTradingViewCsv(csvText, await tradingViewAccountName(userId, fixedAccountId))
    imported = reconstructFills(parsed.fills, "tradingview-csv")
    totalRows = parsed.totalRows
    skippedRows = parsed.skippedRows
    source = "TradingView"
    // A TradingView export carries no market column, so the symbol decides:
    // a futures root gets its contract multiplier, anything else counts one
    // unit per contract (importCsvText's own market is only the filing
    // label, and futures is the sane default for a symbol we recognise).
    market = "futures"
  } else if (isMetaTraderReport(csvText)) {
    const parsed = parseMetaTraderReport(csvText)
    if (!parsed.format) {
      throw new Error("Couldn't find any closed trades in that MetaTrader report — export from Account History → Save as Report")
    }
    imported = parsed.trades
    totalRows = parsed.totalRows
    skippedRows = parsed.skippedRows
    source = parsed.format === "MT5" ? "MetaTrader 5" : "MetaTrader 4"
    market = "forex"
  } else {
    throw new Error(
      "Unrecognized file — export from Tradovate's Reports → Orders, NinjaTrader's Trade Performance → Trades tab, TradingView's Trading Panel → Export data, or MetaTrader's Account History → Save as Report"
    )
  }

  if (imported.length === 0) {
    throw new Error(`No trades found in that ${source} file`)
  }

  // Resolve every trade's target account *before* dedup — dedup has to be
  // scoped per account (a trade already imported into one account should
  // still import into a different account the user picks for this file).
  const accountIdByName = new Map<string, number>()
  if (fixedAccountId == null) {
    for (const t of imported) {
      if (accountIdByName.has(t.account)) continue
      const existingAccount = await db
        .select()
        .from(tradingAccounts)
        .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.name, t.account)))
      if (existingAccount.length) {
        accountIdByName.set(t.account, existingAccount[0].id)
      } else {
        const startingBalance = newAccountStartingBalance != null && newAccountStartingBalance > 0 ? String(newAccountStartingBalance) : "0"
        const [inserted] = await db
          .insert(tradingAccounts)
          .values({ userId, name: t.account, broker: source, startingBalance })
          .returning({ id: tradingAccounts.id })
        accountIdByName.set(t.account, inserted.id)
      }
    }
  }
  const resolved = imported.map((t) => ({
    trade: t,
    accountId: fixedAccountId ?? accountIdByName.get(t.account) ?? null,
  }))

  const existingRows = await db
    .select({ accountId: trades.accountId, externalId: trades.externalId })
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        isNotNull(trades.externalId),
        inArray(
          trades.externalId,
          imported.map((t) => t.externalId)
        )
      )
    )
  const seen = new Set(existingRows.map((r) => `${r.accountId}:${r.externalId}`))
  const toImport = resolved.filter((r) => !seen.has(`${r.accountId}:${r.trade.externalId}`))

  const affectedDays = new Set<string>()

  for (const { trade: t, accountId } of toImport) {
    // MetaTrader trades carry their own broker-reported P&L (see ImportedTrade.pnl);
    // futures brokers don't, so derive it from price × the contract's point value.
    const contractMultiplier = t.pnl != null ? 1 : contractMultiplierForSymbol(t.symbol)
    const pnl =
      t.pnl ??
      computePnl({
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        fees: t.fees,
        contractMultiplier,
      })

    await db.insert(trades).values({
      userId,
      accountId,
      symbol: t.symbol,
      market,
      side: t.side,
      status: "closed",
      quantity: String(t.quantity),
      entryPrice: String(t.entryPrice),
      exitPrice: String(t.exitPrice),
      fees: String(t.fees),
      pnl: String(pnl),
      contractMultiplier: String(contractMultiplier),
      entryTime: new Date(t.entryTime),
      exitTime: new Date(t.exitTime),
      externalId: t.externalId,
    })

    affectedDays.add(t.exitTime.slice(0, 10))
  }

  for (const day of affectedDays) {
    await regenerateJournalForDay(userId, day)
  }

  return {
    source,
    imported: toImport.length,
    duplicates: imported.length - toImport.length,
    skippedRows,
    totalRows,
  }
}

const MAX_STORED_FILE = 2 * 1024 * 1024

// Records an import attempt. Failures keep the file so staff can inspect and
// re-run it; successes don't need it. Never throws.
export async function logImport(entry: {
  userId: string
  fileName: string | null
  csvText: string
  accountId: number | null
  retryOf?: number
  result?: ImportResult
  error?: unknown
}): Promise<number | null> {
  try {
    const failed = entry.error !== undefined
    const [row] = await db
      .insert(importEvents)
      .values({
        userId: entry.userId,
        source: entry.result?.source ?? detectSource(entry.csvText),
        fileName: entry.fileName,
        fileSize: Buffer.byteLength(entry.csvText),
        status: failed ? "failed" : "imported",
        totalRows: entry.result?.totalRows ?? null,
        skippedRows: entry.result?.skippedRows ?? null,
        imported: entry.result?.imported ?? null,
        duplicates: entry.result?.duplicates ?? null,
        error: failed ? (entry.error instanceof Error ? entry.error.message : String(entry.error)).slice(0, 1000) : null,
        accountId: entry.accountId,
        // A retry's own failure is tracked on the original row, so it doesn't
        // also sit in the queue; its file is already on the original.
        fileContent: failed && !entry.retryOf && entry.csvText.length <= MAX_STORED_FILE ? entry.csvText : null,
        retryOf: entry.retryOf ?? null,
        resolvedAt: entry.retryOf ? new Date() : null,
      })
      .returning({ id: importEvents.id })
    return row.id
  } catch (err) {
    console.error("[imports] could not record import", err)
    return null
  }
}
