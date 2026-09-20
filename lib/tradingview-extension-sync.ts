import { and, eq, sql } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import { db } from "@/lib/db"
import { tradingAccounts, tradingviewConnections, tradingviewPairings } from "@/lib/db/schema"
import { TRADINGVIEW_DEFAULT_ACCOUNT } from "@/lib/trade-importer"
import { importTradingViewTrades, storeTradingViewFills, type TradingViewConnectionRow } from "@/lib/tradingview-sync"
import type { ExtensionAccount, ExtensionSyncPayload } from "@/lib/tradingview-extension"

export type TradingViewPairingRow = typeof tradingviewPairings.$inferSelect

export interface ExtensionAccountResult {
  accountId: string // TradingView's id, echoed so the extension can match it up
  accountName: string // the journal account it landed in
  newFills: number
  newTrades: number
}

// The extension checked in: with the pairing page open (its first call,
// which turns the fresh code into a claimed one), or before a sync.
export async function touchPairing(pairing: TradingViewPairingRow, report: { browser: string | null; extensionVersion: string | null }): Promise<void> {
  await db
    .update(tradingviewPairings)
    .set({
      lastSeenAt: new Date(),
      label: report.browser ?? pairing.label,
      extensionVersion: report.extensionVersion ?? pairing.extensionVersion,
    })
    .where(eq(tradingviewPairings.id, pairing.id))
}

// What the journal calls a paper account. TradingView's default one has no
// name of its own (TradingView shows the username), so it takes the same
// name the paste and upload routes use — the three routes then share one
// journal account instead of splitting one paper account three ways.
function journalAccountName(account: ExtensionAccount): string {
  if (account.isDefault || !account.name) return TRADINGVIEW_DEFAULT_ACCOUNT
  return `TradingView – ${account.name}`.slice(0, 80)
}

// The connection for one TradingView paper account, created on first sight
// along with the journal account its trades go in.
async function connectionFor(pairing: TradingViewPairingRow, account: ExtensionAccount): Promise<TradingViewConnectionRow> {
  const [existing] = await db
    .select()
    .from(tradingviewConnections)
    .where(
      and(
        eq(tradingviewConnections.userId, pairing.userId),
        eq(tradingviewConnections.kind, "extension"),
        eq(tradingviewConnections.externalAccountId, account.accountId),
      ),
    )
  if (existing) return existing

  const name = journalAccountName(account)
  const [ownedAccount] = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, pairing.userId), eq(tradingAccounts.name, name)))
  const accountId =
    ownedAccount?.id ??
    (
      await db
        .insert(tradingAccounts)
        .values({
          userId: pairing.userId,
          name,
          broker: "TradingView",
          currency: account.currency,
          startingBalance: String(account.initialBalance ?? account.balance ?? 0),
          currentBalance: account.balance == null ? null : String(account.balance),
          balanceUpdatedAt: account.balance == null ? null : new Date(),
        })
        .returning({ id: tradingAccounts.id })
    )[0].id

  const [created] = await db
    .insert(tradingviewConnections)
    .values({
      userId: pairing.userId,
      accountId,
      name,
      market: "stocks",
      webhookToken: randomBytes(32).toString("hex"),
      kind: "extension",
      pairingId: pairing.id,
      externalAccountId: account.accountId,
    })
    .returning()
  return created
}

// TradingView states the paper account's size outright (initialBalance),
// so there's nothing to infer: it's written over a size we guessed or never
// had, and over one on an account this integration created — a reset paper
// account comes back with a new initial balance, and the journal should
// follow it.
async function applyPaperBalance(connection: TradingViewConnectionRow, account: ExtensionAccount): Promise<void> {
  const [journalAccount] = await db.select().from(tradingAccounts).where(eq(tradingAccounts.id, connection.accountId))
  if (!journalAccount) return
  const patch: Partial<typeof tradingAccounts.$inferInsert> = {}
  if (account.balance != null) {
    patch.currentBalance = String(account.balance)
    patch.balanceUpdatedAt = new Date()
  }
  const sizeIsOurs = Number(journalAccount.startingBalance) <= 0 || journalAccount.startingBalanceInferred || journalAccount.broker === "TradingView"
  if (account.initialBalance != null && account.initialBalance > 0 && sizeIsOurs && Number(journalAccount.startingBalance) !== account.initialBalance) {
    patch.startingBalance = String(account.initialBalance)
    patch.startingBalanceInferred = false
  }
  if (journalAccount.currency !== account.currency) patch.currency = account.currency
  if (Object.keys(patch).length > 0) await db.update(tradingAccounts).set(patch).where(eq(tradingAccounts.id, connection.accountId))
}

// Takes one post from a paired browser: every paper account it saw, with the
// fills it hasn't been told are stored yet. Fills go into the same stream
// the webhook feeds, and trades are rebuilt from it once per account.
export async function syncExtensionPayload(pairing: TradingViewPairingRow, payload: ExtensionSyncPayload): Promise<ExtensionAccountResult[]> {
  const results: ExtensionAccountResult[] = []
  let firstError: string | null = null

  for (const account of payload.accounts) {
    try {
      const connection = await connectionFor(pairing, account)
      await applyPaperBalance(connection, account)

      const newFills = await storeTradingViewFills(
        connection,
        account.executions.map((execution) => ({
          eventId: execution.id,
          symbol: execution.symbol,
          action: execution.action,
          quantity: execution.quantity,
          price: execution.price,
          filledAt: execution.filledAt,
          market: execution.market,
        })),
      )
      const newTrades = newFills > 0 ? await importTradingViewTrades(connection) : 0

      if (newFills > 0) {
        await db
          .update(tradingviewConnections)
          .set({ lastEventAt: new Date(), lastStatus: "ok", lastError: null, eventCount: sql`${tradingviewConnections.eventCount} + ${newFills}` })
          .where(eq(tradingviewConnections.id, connection.id))
      }
      results.push({ accountId: account.accountId, accountName: connection.name, newFills, newTrades })
    } catch (err) {
      console.error("[tradingview-extension] could not sync paper account", account.accountId, err)
      firstError ??= err instanceof Error ? err.message : "Could not sync that paper account."
    }
  }

  await db
    .update(tradingviewPairings)
    .set({
      lastSeenAt: new Date(),
      lastSyncAt: new Date(),
      lastStatus: firstError ? "error" : "ok",
      lastError: firstError?.slice(0, 500) ?? null,
      label: payload.browser ?? pairing.label,
      extensionVersion: payload.extensionVersion ?? pairing.extensionVersion,
    })
    .where(eq(tradingviewPairings.id, pairing.id))

  if (firstError && results.length === 0) throw new Error(firstError)
  return results
}
