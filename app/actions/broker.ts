"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { trades, tradingAccounts } from "@/lib/db/schema"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import Papa from "papaparse"
import { isTradovateCsv, parseTradovateOrdersCsv, reconstructTrades } from "@/lib/tradovate-csv"
import { isNinjaTraderCsv, parseNinjaTraderTradesCsv } from "@/lib/ninjatrader-csv"
import { isMetaTraderReport, parseMetaTraderReport } from "@/lib/metatrader-report"
import type { ImportedTrade } from "@/lib/trade-import"
import { computePnl, contractMultiplierForSymbol } from "@/lib/calc"
import { regenerateJournalForDay } from "@/app/actions/trades"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function importTradeCsv(formData: FormData) {
  const userId = await getUserId()
  const file = formData.get("file") as File | null
  if (!file || file.size === 0) throw new Error("Choose a CSV file first")

  const accountIdRaw = formData.get("accountId")
  let fixedAccountId: number | null = null
  if (accountIdRaw && String(accountIdRaw) !== "") {
    fixedAccountId = Number(accountIdRaw)
    const [owned] = await db
      .select()
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.id, fixedAccountId), eq(tradingAccounts.userId, userId)))
    if (!owned) throw new Error("That account no longer exists")
  }

  const csvText = await file.text()

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
      "Unrecognized file — export from Tradovate's Reports → Orders, NinjaTrader's Trade Performance → Trades tab, or MetaTrader's Account History → Save as Report"
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
        const [inserted] = await db
          .insert(tradingAccounts)
          .values({ userId, name: t.account, broker: source })
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

  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/journal")
  revalidatePath("/calendar")
  revalidatePath("/reports")
  revalidatePath("/settings")

  return {
    source,
    imported: toImport.length,
    duplicates: imported.length - toImport.length,
    skippedRows,
    totalRows,
  }
}
