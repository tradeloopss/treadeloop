"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { encrypt } from "@/lib/crypto"
import { tradingAccounts, metatraderConnections, rithmicConnections, providerAccounts, orderCommands } from "@/lib/db/schema"
import { getPropMaxAccount } from "@/lib/propmax/account"
import { guardOrder } from "@/lib/order-execution/guard"
import type { OrderBroker, OrderCommandInput, OrderStatus } from "@/lib/order-execution/types"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export interface ExecutionCapability {
  broker: OrderBroker | null
  // Execution is possible for this broker at all (mt5/mt4/rithmic yes;
  // tradovate not until its API is connected).
  supported: boolean
  // Execution is turned on for THIS account (a trading credential is stored).
  enabled: boolean
  note: string
}

// Work out how (and whether) an account can send orders.
async function resolveExecution(userId: string, accountId: number): Promise<ExecutionCapability & { mtConnectionId?: number }> {
  const [mt] = await db
    .select({ id: metatraderConnections.id, platform: metatraderConnections.platform, hasTrading: metatraderConnections.tradingPasswordEnc })
    .from(metatraderConnections)
    .where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.accountId, accountId)))
  if (mt) {
    const broker = (mt.platform === "mt4" ? "mt4" : "mt5") as OrderBroker
    const enabled = mt.hasTrading != null
    return {
      broker,
      supported: true,
      enabled,
      note: enabled ? "Order execution is on for this account." : "Add your master (trading) password to enable order execution.",
      mtConnectionId: mt.id,
    }
  }

  const [rith] = await db.select({ id: rithmicConnections.id }).from(rithmicConnections).where(and(eq(rithmicConnections.userId, userId), eq(rithmicConnections.accountId, accountId)))
  if (rith) {
    return { broker: "rithmic", supported: true, enabled: true, note: "Rithmic order routing requires an order-routing-enabled login." }
  }

  const [tv] = await db.select({ id: providerAccounts.id }).from(providerAccounts).where(eq(providerAccounts.tradingAccountId, accountId))
  if (tv) {
    return { broker: "tradovate", supported: false, enabled: false, note: "Tradovate order execution is dormant until Tradovate API access is connected." }
  }

  return { broker: null, supported: false, enabled: false, note: "This account isn't linked to a broker TradeLoop can send orders to." }
}

export async function getExecutionCapability(accountId: number): Promise<ExecutionCapability> {
  const userId = await getUserId()
  const { broker, supported, enabled, note } = await resolveExecution(userId, accountId)
  return { broker, supported, enabled, note }
}

// Store the master/trading password for an MT account — turns order execution
// on. The password is encrypted (AES-GCM) exactly like the investor one and is
// only ever used by the VPS bridge to send orders.
export async function setTradingPassword(accountId: number, password: string) {
  const userId = await getUserId()
  if (!password.trim()) throw new Error("Enter your master (trading) password.")
  const [mt] = await db.select({ id: metatraderConnections.id }).from(metatraderConnections).where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.accountId, accountId)))
  if (!mt) throw new Error("This account isn't a MetaTrader connection.")
  await db.update(metatraderConnections).set({ tradingPasswordEnc: encrypt(password.trim()) }).where(eq(metatraderConnections.id, mt.id))
  revalidatePath("/trade-manager")
}

export async function disableExecution(accountId: number) {
  const userId = await getUserId()
  await db
    .update(metatraderConnections)
    .set({ tradingPasswordEnc: null })
    .where(and(eq(metatraderConnections.userId, userId), eq(metatraderConnections.accountId, accountId)))
  revalidatePath("/trade-manager")
}

export interface SubmitResult {
  id: number | null
  status: OrderStatus
  message: string
  reasons: string[]
}

// The single entry point the UI calls to act on a broker. It vets the order
// against the account's prop-firm rules, then writes a command for the right
// broker's executor to pick up — or refuses it (blocked / unsupported / not
// enabled) without ever touching a broker.
export async function submitOrder(input: OrderCommandInput): Promise<SubmitResult> {
  const userId = await getUserId()

  const [account] = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(and(eq(tradingAccounts.id, input.accountId), eq(tradingAccounts.userId, userId)))
  if (!account) throw new Error("Account not found.")

  const cap = await resolveExecution(userId, input.accountId)
  if (cap.broker == null) return { id: null, status: "failed", message: cap.note, reasons: [cap.note] }
  if (!cap.supported) return { id: null, status: "unsupported", message: cap.note, reasons: [cap.note] }
  if ((cap.broker === "mt5" || cap.broker === "mt4") && !cap.enabled) {
    return { id: null, status: "failed", message: cap.note, reasons: ["Order execution isn't enabled for this account yet."] }
  }

  // Rule guard — needs the account's live evaluation (if it's tracked).
  const view = await getPropMaxAccount(userId, input.accountId).catch(() => null)
  const decision = guardOrder(input, view?.evaluation ?? null)
  if (!decision.allowed) {
    const [row] = await db
      .insert(orderCommands)
      .values({ userId, accountId: input.accountId, broker: cap.broker, kind: input.kind, status: "blocked", ...orderColumns(input), ruleCheck: decision, resultMessage: decision.reasons.join(" ") })
      .returning({ id: orderCommands.id })
    return { id: row.id, status: "blocked", message: "Blocked by your prop-firm rules.", reasons: decision.reasons }
  }

  const [row] = await db
    .insert(orderCommands)
    .values({ userId, accountId: input.accountId, broker: cap.broker, kind: input.kind, status: "pending", ...orderColumns(input), ruleCheck: decision })
    .returning({ id: orderCommands.id })

  revalidatePath("/trade-manager")
  return { id: row.id, status: "pending", message: "Order sent to your broker.", reasons: decision.reasons }
}

function orderColumns(input: OrderCommandInput) {
  const s = (n: number | null | undefined) => (n != null ? String(n) : null)
  return {
    positionRef: input.positionRef ?? null,
    orderRef: input.orderRef ?? null,
    symbol: input.symbol ?? null,
    side: input.side ?? null,
    volume: s(input.volume),
    price: s(input.price),
    stopLoss: s(input.stopLoss),
    takeProfit: s(input.takeProfit),
    orderType: input.orderType ?? null,
  }
}

export async function getOrderStatus(id: number): Promise<{ status: OrderStatus; message: string | null } | null> {
  const userId = await getUserId()
  const [row] = await db.select({ status: orderCommands.status, resultMessage: orderCommands.resultMessage }).from(orderCommands).where(and(eq(orderCommands.id, id), eq(orderCommands.userId, userId)))
  return row ? { status: row.status as OrderStatus, message: row.resultMessage } : null
}
