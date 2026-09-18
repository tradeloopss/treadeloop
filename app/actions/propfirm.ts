"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, propFirmRules, propFirmTransactions, trades } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { evaluatePropFirmAccount, type PropFirmEvaluation, type PropFirmRules } from "@/lib/propfirm-rules"
import { isPro } from "@/lib/subscription"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export interface PropFirmAccount {
  id: number
  name: string
  broker: string | null
  startingBalance: number
  currency: string
  firmName: string | null
  planType: string | null
  breachReasonTag: string | null
  autoDetected: boolean
  trackedSince: string | null
  rules: PropFirmRules | null
  evaluation: PropFirmEvaluation | null
}

export interface PropFirmTransaction {
  id: number
  accountId: number
  type: "cost" | "payout"
  category: string | null
  amount: number
  occurredAt: string
  note: string | null
}

// One account can only be evaluated against one rule set at a time — status
// is always computed live from the account's current closed trades, never
// cached, so it's automatically up to date after every sync.
export async function getPropFirmAccounts(): Promise<PropFirmAccount[]> {
  const userId = await getUserId()

  const accounts = await db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
  const rulesRows = await db.select().from(propFirmRules).where(eq(propFirmRules.userId, userId))
  const rulesByAccountId = new Map(rulesRows.map((r) => [r.accountId, r]))

  const result: PropFirmAccount[] = []
  for (const account of accounts) {
    const ruleRow = rulesByAccountId.get(account.id)
    let rules: PropFirmRules | null = null
    let evaluation: PropFirmEvaluation | null = null

    if (ruleRow) {
      rules = {
        phase: ruleRow.phase,
        profitTargetPct: ruleRow.profitTargetPct != null ? Number(ruleRow.profitTargetPct) : null,
        maxDrawdownPct: Number(ruleRow.maxDrawdownPct),
        drawdownType: ruleRow.drawdownType as "trailing" | "static",
        dailyLossLimitPct: ruleRow.dailyLossLimitPct != null ? Number(ruleRow.dailyLossLimitPct) : null,
        minTradingDays: ruleRow.minTradingDays,
      }

      const accountTrades = await db
        .select({ exitTime: trades.exitTime, pnl: trades.pnl })
        .from(trades)
        .where(and(eq(trades.accountId, account.id), eq(trades.status, "closed")))

      evaluation = evaluatePropFirmAccount(
        rules,
        Number(account.startingBalance),
        accountTrades
          .filter((t) => t.exitTime != null)
          .map((t) => ({ exitTime: t.exitTime!.toISOString(), pnl: Number(t.pnl) })),
        ruleRow.openingBalanceAdjustment != null ? Number(ruleRow.openingBalanceAdjustment) : 0
      )

      // Auto-promote a passed evaluation to funded — no manual phase flip
      // needed. Only fires on the transition itself (skips accounts already
      // funded), and never touches a breached account's phase.
      if (evaluation.status === "passed" && rules.phase !== "funded") {
        await db.update(propFirmRules).set({ phase: "funded" }).where(eq(propFirmRules.id, ruleRow!.id))
        rules.phase = "funded"
      }
    }

    result.push({
      id: account.id,
      name: account.name,
      broker: account.broker,
      startingBalance: Number(account.startingBalance),
      currency: account.currency,
      firmName: ruleRow?.firmName ?? null,
      planType: ruleRow?.planType ?? null,
      breachReasonTag: ruleRow?.breachReasonTag ?? null,
      autoDetected: ruleRow?.autoDetected ?? false,
      trackedSince: ruleRow?.createdAt ? ruleRow.createdAt.toISOString() : null,
      rules,
      evaluation,
    })
  }

  return result
}

export async function savePropFirmRules(accountId: number, formData: FormData) {
  const userId = await getUserId()
  const [account] = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
  if (!account) throw new Error("Account not found")

  const firmNameRaw = String(formData.get("firmName") ?? "").trim()
  const firmName = firmNameRaw !== "" ? firmNameRaw : null
  const planTypeRaw = String(formData.get("planType") ?? "").trim()
  const planType = planTypeRaw !== "" ? planTypeRaw : null
  const phase = String(formData.get("phase") ?? "evaluation")
  const profitTargetRaw = formData.get("profitTargetPct")
  const profitTargetPct = profitTargetRaw && String(profitTargetRaw).trim() !== "" ? Number(profitTargetRaw) : null
  const maxDrawdownPct = Number(formData.get("maxDrawdownPct") ?? 0)
  const drawdownType = String(formData.get("drawdownType") ?? "trailing") === "static" ? "static" : "trailing"
  const dailyLossRaw = formData.get("dailyLossLimitPct")
  const dailyLossLimitPct = dailyLossRaw && String(dailyLossRaw).trim() !== "" ? Number(dailyLossRaw) : null
  const minDaysRaw = formData.get("minTradingDays")
  const minTradingDays = minDaysRaw && String(minDaysRaw).trim() !== "" ? Number(minDaysRaw) : null

  if (!maxDrawdownPct || maxDrawdownPct <= 0) {
    throw new Error("Max drawdown % is required")
  }

  const [existing] = await db.select().from(propFirmRules).where(eq(propFirmRules.accountId, accountId))
  if (existing) {
    await db
      .update(propFirmRules)
      .set({
        firmName,
        planType,
        phase,
        profitTargetPct: profitTargetPct != null ? String(profitTargetPct) : null,
        maxDrawdownPct: String(maxDrawdownPct),
        drawdownType,
        dailyLossLimitPct: dailyLossLimitPct != null ? String(dailyLossLimitPct) : null,
        minTradingDays,
        autoDetected: false,
      })
      .where(eq(propFirmRules.id, existing.id))
  } else {
    await db.insert(propFirmRules).values({
      accountId,
      userId,
      firmName,
      planType,
      phase,
      profitTargetPct: profitTargetPct != null ? String(profitTargetPct) : null,
      maxDrawdownPct: String(maxDrawdownPct),
      drawdownType,
      dailyLossLimitPct: dailyLossLimitPct != null ? String(dailyLossLimitPct) : null,
      minTradingDays,
      autoDetected: false,
    })
  }

  revalidatePath("/propfirm")
}

export async function deletePropFirmRules(accountId: number) {
  const userId = await getUserId()
  await db.delete(propFirmRules).where(and(eq(propFirmRules.accountId, accountId), eq(propFirmRules.userId, userId)))
  revalidatePath("/propfirm")
}

export async function setBreachReason(accountId: number, reason: string | null) {
  const userId = await getUserId()
  await db
    .update(propFirmRules)
    .set({ breachReasonTag: reason })
    .where(and(eq(propFirmRules.accountId, accountId), eq(propFirmRules.userId, userId)))
  revalidatePath("/propfirm")
}

export async function logPropFirmTransaction(accountId: number, formData: FormData) {
  const userId = await getUserId()
  const [account] = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
  if (!account) throw new Error("Account not found")

  const type = String(formData.get("type") ?? "cost") === "payout" ? "payout" : "cost"
  const category = type === "cost" ? String(formData.get("category") ?? "evaluation_fee") : null
  const amount = Number(formData.get("amount") ?? 0)
  const occurredAtRaw = String(formData.get("occurredAt") ?? "").trim()
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date()
  const note = String(formData.get("note") ?? "").trim() || null

  if (!amount || amount <= 0) throw new Error("Amount must be greater than 0")

  await db.insert(propFirmTransactions).values({ accountId, userId, type, category, amount: String(amount), occurredAt, note })
  revalidatePath("/propfirm")
}

export async function deletePropFirmTransaction(id: number) {
  const userId = await getUserId()
  await db.delete(propFirmTransactions).where(and(eq(propFirmTransactions.id, id), eq(propFirmTransactions.userId, userId)))
  revalidatePath("/propfirm")
}

export async function getPropFirmTransactions(): Promise<PropFirmTransaction[]> {
  const userId = await getUserId()
  const rows = await db.select().from(propFirmTransactions).where(eq(propFirmTransactions.userId, userId))
  return rows
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      type: r.type as "cost" | "payout",
      category: r.category,
      amount: Number(r.amount),
      occurredAt: r.occurredAt.toISOString(),
      note: r.note,
    }))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
}

// Creates a new trading account AND its prop firm rules in one step — the
// guided manual-entry flow (firm -> plan -> size/balance/situation) doesn't
// require an existing account the way "track an existing account" does.
export async function createManualPropFirmAccount(formData: FormData): Promise<number> {
  const userId = await getUserId()

  // Same Essential-plan cap as createAccount (app/actions/accounts.ts) — this
  // path creates a tradingAccounts row too, so it must respect the same limit.
  if (!(await isPro(userId))) {
    const existing = await db.select({ id: tradingAccounts.id }).from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
    if (existing.length >= 1) {
      throw new Error("You've reached the maximum number of accounts for your plan (1) — upgrade to Pro at /pricing to connect more.")
    }
  }

  const firmNameRaw = String(formData.get("firmName") ?? "").trim()
  const firmName = firmNameRaw !== "" ? firmNameRaw : null
  const planTypeRaw = String(formData.get("planType") ?? "").trim()
  const planType = planTypeRaw !== "" ? planTypeRaw : null
  const nameRaw = String(formData.get("name") ?? "").trim()
  const name = nameRaw !== "" ? nameRaw : [firmName, planType].filter(Boolean).join(" ") || "Prop Firm Account"
  const phase = String(formData.get("phase") ?? "evaluation")

  const startingBalance = Number(formData.get("startingBalance") ?? 0)
  if (!startingBalance || startingBalance <= 0) throw new Error("Account size is required")
  const currentBalanceRaw = formData.get("currentBalance")
  const currentBalance = currentBalanceRaw && String(currentBalanceRaw).trim() !== "" ? Number(currentBalanceRaw) : null
  const openingBalanceAdjustment = currentBalance != null ? currentBalance - startingBalance : null

  const profitTargetRaw = formData.get("profitTargetPct")
  const profitTargetPct = profitTargetRaw && String(profitTargetRaw).trim() !== "" ? Number(profitTargetRaw) : null
  const maxDrawdownPct = Number(formData.get("maxDrawdownPct") ?? 0)
  if (!maxDrawdownPct || maxDrawdownPct <= 0) throw new Error("Max drawdown % is required")
  const drawdownType = String(formData.get("drawdownType") ?? "trailing") === "static" ? "static" : "trailing"
  const dailyLossRaw = formData.get("dailyLossLimitPct")
  const dailyLossLimitPct = dailyLossRaw && String(dailyLossRaw).trim() !== "" ? Number(dailyLossRaw) : null
  const minDaysRaw = formData.get("minTradingDays")
  const minTradingDays = minDaysRaw && String(minDaysRaw).trim() !== "" ? Number(minDaysRaw) : null

  const [account] = await db
    .insert(tradingAccounts)
    .values({
      userId,
      name,
      broker: null,
      startingBalance: String(startingBalance),
      currentBalance: currentBalance != null ? String(currentBalance) : null,
      currency: "USD",
    })
    .returning({ id: tradingAccounts.id })

  await db.insert(propFirmRules).values({
    accountId: account.id,
    userId,
    firmName,
    planType,
    phase,
    profitTargetPct: profitTargetPct != null ? String(profitTargetPct) : null,
    maxDrawdownPct: String(maxDrawdownPct),
    drawdownType,
    dailyLossLimitPct: dailyLossLimitPct != null ? String(dailyLossLimitPct) : null,
    minTradingDays,
    openingBalanceAdjustment: openingBalanceAdjustment != null ? String(openingBalanceAdjustment) : null,
    autoDetected: false,
  })

  revalidatePath("/propfirm")
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/settings")

  return account.id
}
