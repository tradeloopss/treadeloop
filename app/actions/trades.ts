"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { trades, journalEntries } from "@/lib/db/schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { computePnl, computeRMultiple } from "@/lib/calc"
import { generateDailyNarrative } from "@/lib/journal-ai"
import { getActiveAccountIds, getManualEntryLockedAccountIds } from "@/app/actions/accounts"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

function num(v: FormDataEntryValue | null, fallback = 0): number {
  if (v == null || v === "") return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function str(v: FormDataEntryValue | null): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === "" ? null : s
}

export async function getTrades() {
  const userId = await getUserId()
  const activeAccountIds = await getActiveAccountIds()
  const where = activeAccountIds != null
    ? and(eq(trades.userId, userId), inArray(trades.accountId, activeAccountIds))
    : eq(trades.userId, userId)
  return db.select().from(trades).where(where).orderBy(desc(trades.entryTime))
}

// Ignores the cookie-based "active accounts" filter on purpose — the
// per-account dashboard (app/(app)/accounts/[id]/page.tsx) always wants
// exactly this one account's trades regardless of what's selected elsewhere.
export async function getAccountTrades(accountId: number) {
  const userId = await getUserId()
  return db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.accountId, accountId)))
    .orderBy(desc(trades.entryTime))
}

// Same idea for an arbitrary set of accounts — powers the Prop Firm
// Tracker's "Funded" dashboard tab (only funded-phase accounts' trades).
export async function getTradesForAccounts(accountIds: number[]) {
  if (accountIds.length === 0) return []
  const userId = await getUserId()
  return db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.accountId, accountIds)))
    .orderBy(desc(trades.entryTime))
}

export async function createTrade(formData: FormData) {
  const userId = await getUserId()

  // Prop firm and live-synced accounts are import-only — their trades must
  // come from the broker/firm itself (Rithmic auto-sync, or a file upload for
  // Tradovate and the rest), never hand-entered. Checked here and not just in
  // the form, since the form's account list is only a UI-level filter.
  const targetAccountId = formData.get("accountId") ? num(formData.get("accountId")) : null
  if (targetAccountId != null) {
    const locked = await getManualEntryLockedAccountIds()
    if (locked.includes(targetAccountId)) {
      throw new Error(
        "This account is synced from your broker or tracked as a prop firm account — add trades with Rithmic auto-sync or a file upload instead of entering them by hand."
      )
    }
  }

  const side = (str(formData.get("side")) ?? "long") as "long" | "short"
  const status = (str(formData.get("status")) ?? "closed") as "open" | "closed"
  const quantity = num(formData.get("quantity"), 1)
  const entryPrice = num(formData.get("entryPrice"))
  const exitRaw = formData.get("exitPrice")
  const exitPrice = status === "open" || exitRaw == null || exitRaw === "" ? null : num(exitRaw)
  const stopRaw = formData.get("stopLoss")
  const stopLoss = stopRaw == null || stopRaw === "" ? null : num(stopRaw)
  const fees = num(formData.get("fees"))
  const contractMultiplier = num(formData.get("contractMultiplier"), 1)

  const tradeInput = { side, quantity, entryPrice, exitPrice, stopLoss, fees, contractMultiplier }
  const pnl = status === "closed" ? computePnl(tradeInput) : 0
  const rMultiple = status === "closed" ? computeRMultiple(tradeInput) : null

  const entryTime = str(formData.get("entryTime"))
  const exitTime = str(formData.get("exitTime"))
  const mistakes = (str(formData.get("mistakes")) ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
  const tags = (str(formData.get("tags")) ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)

  await db.insert(trades).values({
    userId,
    accountId: formData.get("accountId") ? num(formData.get("accountId")) : null,
    playbookId: formData.get("playbookId") ? num(formData.get("playbookId")) : null,
    symbol: (str(formData.get("symbol")) ?? "UNKNOWN").toUpperCase(),
    market: str(formData.get("market")) ?? "futures",
    side,
    status,
    quantity: String(quantity),
    entryPrice: String(entryPrice),
    exitPrice: exitPrice == null ? null : String(exitPrice),
    stopLoss: stopLoss == null ? null : String(stopLoss),
    takeProfit: formData.get("takeProfit") ? String(num(formData.get("takeProfit"))) : null,
    fees: String(fees),
    pnl: String(pnl),
    rMultiple: rMultiple == null ? null : String(rMultiple),
    contractMultiplier: String(contractMultiplier),
    expirationDate: str(formData.get("expirationDate")) ? new Date(str(formData.get("expirationDate"))!) : null,
    entryTime: entryTime ? new Date(entryTime) : new Date(),
    exitTime: exitTime ? new Date(exitTime) : status === "closed" ? new Date() : null,
    rating: formData.get("rating") ? num(formData.get("rating")) : null,
    mistakes,
    tags,
    notes: str(formData.get("notes")),
  })

  // Refresh the automated journal for the trade's day.
  const day = (exitTime ?? entryTime ?? new Date().toISOString()).slice(0, 10)
  await regenerateJournalForDay(userId, day)

  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/journal")
  revalidatePath("/calendar")
  revalidatePath("/reports")
}

export async function updateTradeNotes(id: number, notes: string) {
  const userId = await getUserId()
  await db
    .update(trades)
    .set({ notes: notes.trim() === "" ? null : notes })
    .where(and(eq(trades.id, id), eq(trades.userId, userId)))
  revalidatePath("/trades")
}

export async function deleteTrade(id: number) {
  const userId = await getUserId()
  const [trade] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)))
  await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)))

  if (trade) {
    const day = (trade.exitTime ?? trade.entryTime).toISOString().slice(0, 10)
    await regenerateJournalForDay(userId, day)
  }

  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/journal")
  revalidatePath("/calendar")
  revalidatePath("/reports")
}

// Rebuilds the auto summary for a given day from that day's trades — an
// AI-written narrative when an API key is configured, otherwise a templated
// one. Called after every create/delete (and broker sync) so it never goes stale.
export async function regenerateJournalForDay(userId: string, day: string) {
  const all = await db.select().from(trades).where(eq(trades.userId, userId))
  const dayTrades = all.filter((t) => {
    const d = (t.exitTime ?? t.entryTime)?.toISOString().slice(0, 10)
    return d === day
  })

  const existing = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, day)))

  if (dayTrades.length === 0) {
    // No trades left on this day — clear the summary but keep any manual reflection.
    if (existing.length) {
      await db
        .update(journalEntries)
        .set({ autoSummary: null })
        .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, day)))
    }
    return
  }

  const net = dayTrades.reduce((a, t) => a + Number(t.pnl), 0)
  const wins = dayTrades.filter((t) => Number(t.pnl) > 0).length
  const losses = dayTrades.filter((t) => Number(t.pnl) < 0).length
  const symbols = Array.from(new Set(dayTrades.map((t) => t.symbol)))
  const allMistakes = Array.from(new Set(dayTrades.flatMap((t) => t.mistakes ?? [])))
  const winRate = dayTrades.length ? Math.round((wins / dayTrades.length) * 100) : 0

  const fallbackSummary =
    `Traded ${dayTrades.length} position${dayTrades.length === 1 ? "" : "s"} on ${symbols.join(", ")}. ` +
    `Net P&L ${net >= 0 ? "+" : ""}${net.toFixed(2)} with ${wins}W / ${losses}L (${winRate}% win rate). ` +
    (allMistakes.length ? `Flagged mistakes: ${allMistakes.join(", ")}.` : `No mistakes flagged — clean execution.`)

  const summary = (await generateDailyNarrative(day, dayTrades)) ?? fallbackSummary

  if (existing.length) {
    await db
      .update(journalEntries)
      .set({ autoSummary: summary })
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, day)))
  } else {
    await db.insert(journalEntries).values({ userId, date: day, autoSummary: summary })
  }
}
