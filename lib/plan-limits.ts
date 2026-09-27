import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { metatraderConnections, tradingAccounts } from "@/lib/db/schema"
import { isPro } from "@/lib/subscription"
import {
  ACCOUNT_LIMIT_MESSAGE,
  ESSENTIAL_ACCOUNT_LIMIT,
  ESSENTIAL_METATRADER_LIMIT,
  METATRADER_LIMIT_MESSAGE,
  PRO_ACCOUNT_LIMIT,
  PRO_ACCOUNT_LIMIT_MESSAGE,
} from "@/lib/plan-allowance"

// Enforces the Essential allowance (lib/plan-allowance.ts). Accounts that
// already exist beyond it are kept; only adding more is blocked.
//
// Limits come back as messages rather than exceptions: an error thrown from a
// server action reaches the browser without its message in production, so
// actions return these to the form instead.
// For library code that can't return a message (the file importer): the
// calling action catches this and returns its message.
export class PlanLimitError extends Error {}

// Active (non-archived) accounts — archived accounts don't count against a
// plan's allowance.
export async function countAccounts(userId: string): Promise<number> {
  const rows = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.userId, userId), eq(tradingAccounts.archived, false)))
  return rows.length
}

// Null when adding `adding` more accounts fits the user's plan, else why not.
// Essential is capped at 3 active accounts, Pro at 40.
export async function accountLimitError(userId: string, adding = 1): Promise<string | null> {
  if (adding <= 0) return null
  const pro = await isPro(userId)
  const limit = pro ? PRO_ACCOUNT_LIMIT : ESSENTIAL_ACCOUNT_LIMIT
  if ((await countAccounts(userId)) + adding > limit) return pro ? PRO_ACCOUNT_LIMIT_MESSAGE : ACCOUNT_LIMIT_MESSAGE
  return null
}

// Null when this MetaTrader login may be connected: always on Pro; on
// Essential only as the user's one synced account (reconnecting that same
// login is fine), and only while there's room for the account it creates.
export async function metatraderLimitError(userId: string, target: { platform: string; login: string; server: string }): Promise<string | null> {
  const connections = await db
    .select({ platform: metatraderConnections.platform, login: metatraderConnections.login, server: metatraderConnections.server })
    .from(metatraderConnections)
    .where(eq(metatraderConnections.userId, userId))
  // Reconnecting an existing login creates no new account, so it's always fine.
  if (connections.some((c) => c.platform === target.platform && c.login === target.login && c.server === target.server)) return null
  // Pro: live sync on any number of MT accounts, capped only by the 40-account limit.
  if (await isPro(userId)) return accountLimitError(userId, 1)
  if (connections.length >= ESSENTIAL_METATRADER_LIMIT) return METATRADER_LIMIT_MESSAGE
  return accountLimitError(userId, 1)
}
