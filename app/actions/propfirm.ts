"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts, propFirmRules, propFirmTransactions, trades, rithmicConnections } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { evaluatePropFirmAccount, type PropFirmEvaluation, type PropFirmRules } from "@/lib/propfirm-rules"
import { findPreset, resolvePresetRules } from "@/lib/propfirm-presets"
import { accountLimitError } from "@/lib/plan-limits"

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
  // True when the size is our guess from the broker's balance rather than
  // something the user entered — the UI asks them to confirm it.
  startingBalanceInferred: boolean
  currency: string
  // The balance and liquidation floor as the broker last reported them —
  // null for accounts that aren't linked to a live source.
  brokerBalance: number | null
  balanceUpdatedAt: string | null
  brokerDrawdownFloor: number | null
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
  const payoutRows = await db
    .select({ accountId: propFirmTransactions.accountId, amount: propFirmTransactions.amount, occurredAt: propFirmTransactions.occurredAt })
    .from(propFirmTransactions)
    .where(and(eq(propFirmTransactions.userId, userId), eq(propFirmTransactions.type, "payout")))
  const linkedAccountIds = new Set(
    (await db.select({ accountId: rithmicConnections.accountId }).from(rithmicConnections).where(eq(rithmicConnections.userId, userId))).map((r) => r.accountId)
  )

  const result: PropFirmAccount[] = []
  for (const account of accounts) {
    const ruleRow = rulesByAccountId.get(account.id)
    let rules: PropFirmRules | null = null
    let evaluation: PropFirmEvaluation | null = null
    const brokerLinked = linkedAccountIds.has(account.id) && account.currentBalance != null && account.balanceUpdatedAt != null

    if (ruleRow) {
      // Rows from before thresholds were stored in dollars only have
      // percentages. When the row is on a known plan, fill the dollar
      // figures in from the preset for this account's size — the
      // percentages were the preset's own, so nothing the user chose is
      // lost, and plans whose figures don't scale with size (FFF) come out
      // right instead of approximately.
      const startingBalance = Number(account.startingBalance)
      if (ruleRow.maxDrawdownAmount == null && startingBalance > 0) {
        const preset = findPreset(ruleRow.firmName, ruleRow.planType)
        if (preset) {
          const columns = ruleColumns(resolvePresetRules(preset, startingBalance, ruleRow.phase))
          await db.update(propFirmRules).set(columns).where(eq(propFirmRules.id, ruleRow.id))
          Object.assign(ruleRow, columns)
        }
      }
      rules = rulesFromRow(ruleRow)

      const accountTrades = await db
        .select({ exitTime: trades.exitTime, pnl: trades.pnl })
        .from(trades)
        .where(and(eq(trades.accountId, account.id), eq(trades.status, "closed")))
      const closed = accountTrades.filter((t) => t.exitTime != null).map((t) => ({ exitTime: t.exitTime!.toISOString(), pnl: Number(t.pnl) }))
      const payouts = payoutRows.filter((p) => p.accountId === account.id).map((p) => ({ at: p.occurredAt.toISOString(), amount: Number(p.amount) }))

      // For a broker-linked account the balance Rithmic reports is the
      // truth, and the walk is made to land on it: whatever the imported
      // trades and logged payouts don't account for (commissions, fees,
      // trades from before the fill history starts) becomes the opening
      // offset. Manual accounts keep the offset the user entered.
      const openingAdjustment = brokerLinked
        ? Number(account.currentBalance) - startingBalance - closed.reduce((sum, t) => sum + t.pnl, 0) + payouts.reduce((sum, p) => sum + p.amount, 0)
        : ruleRow.openingBalanceAdjustment != null
          ? Number(ruleRow.openingBalanceAdjustment)
          : 0

      evaluation = evaluatePropFirmAccount(rules, startingBalance, closed, openingAdjustment, payouts)

      // Auto-promote a passed evaluation to funded — no manual phase flip
      // needed. Only fires on the transition itself (skips accounts already
      // funded), and never touches a breached account's phase. When the
      // account is on a known plan the funded-stage rules come with it.
      if (evaluation.status === "passed" && rules.phase !== "funded") {
        const preset = findPreset(ruleRow.firmName, ruleRow.planType)
        const fundedRules = preset ? ruleColumns(resolvePresetRules(preset, startingBalance, "funded")) : {}
        await db.update(propFirmRules).set({ phase: "funded", ...fundedRules }).where(eq(propFirmRules.id, ruleRow.id))
        rules = rulesFromRow({ ...ruleRow, phase: "funded", ...fundedRules })
        evaluation = evaluatePropFirmAccount(rules, startingBalance, closed, openingAdjustment, payouts)
      }
    }

    result.push({
      id: account.id,
      name: account.name,
      broker: account.broker,
      startingBalance: Number(account.startingBalance),
      startingBalanceInferred: account.startingBalanceInferred,
      currency: account.currency,
      brokerBalance: brokerLinked ? Number(account.currentBalance) : null,
      balanceUpdatedAt: brokerLinked ? account.balanceUpdatedAt!.toISOString() : null,
      brokerDrawdownFloor: brokerLinked && account.brokerDrawdownFloor != null ? Number(account.brokerDrawdownFloor) : null,
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

type RuleRow = typeof propFirmRules.$inferSelect

function rulesFromRow(row: Pick<RuleRow, "phase" | "profitTargetPct" | "maxDrawdownPct" | "drawdownType" | "dailyLossLimitPct" | "minTradingDays" | "profitTargetAmount" | "maxDrawdownAmount" | "dailyLossLimitAmount" | "consistencyPct" | "minPayoutDays" | "minDayProfit" | "payoutCap">): PropFirmRules {
  const num = (v: string | null) => (v != null ? Number(v) : null)
  return {
    phase: row.phase,
    profitTargetPct: num(row.profitTargetPct),
    maxDrawdownPct: Number(row.maxDrawdownPct),
    drawdownType: row.drawdownType as "trailing" | "static",
    dailyLossLimitPct: num(row.dailyLossLimitPct),
    minTradingDays: row.minTradingDays,
    profitTargetAmount: num(row.profitTargetAmount),
    maxDrawdownAmount: num(row.maxDrawdownAmount),
    dailyLossLimitAmount: num(row.dailyLossLimitAmount),
    consistencyPct: num(row.consistencyPct),
    minPayoutDays: row.minPayoutDays,
    minDayProfit: num(row.minDayProfit),
    payoutCap: num(row.payoutCap),
  }
}

// The rule thresholds as stored: dollar amounts, with the matching
// percentage of the account size alongside for display.
interface RuleValues {
  profitTargetAmount: number | null
  profitTargetPct: number | null
  maxDrawdownAmount: number
  maxDrawdownPct: number
  drawdownType: "trailing" | "static"
  dailyLossLimitAmount: number | null
  dailyLossLimitPct: number | null
  minTradingDays: number | null
  consistencyPct: number | null
  minPayoutDays: number | null
  minDayProfit: number | null
  payoutCap: number | null
}

function ruleColumns(values: RuleValues) {
  const str = (v: number | null) => (v != null ? String(v) : null)
  return {
    profitTargetPct: str(values.profitTargetPct),
    maxDrawdownPct: String(values.maxDrawdownPct),
    drawdownType: values.drawdownType,
    dailyLossLimitPct: str(values.dailyLossLimitPct),
    minTradingDays: values.minTradingDays,
    profitTargetAmount: str(values.profitTargetAmount),
    maxDrawdownAmount: String(values.maxDrawdownAmount),
    dailyLossLimitAmount: str(values.dailyLossLimitAmount),
    consistencyPct: str(values.consistencyPct),
    minPayoutDays: values.minPayoutDays,
    minDayProfit: str(values.minDayProfit),
    payoutCap: str(values.payoutCap),
  }
}

// Rule fields as the forms submit them: dollar amounts (the way firms
// publish rules), with the percentage-of-size fields still accepted from
// older clients. Percentages are derived from the account size for display.
function parseRuleFields(formData: FormData, accountSize: number): RuleValues {
  const optional = (name: string) => {
    const raw = formData.get(name)
    return raw != null && String(raw).trim() !== "" ? Number(raw) : null
  }
  const pctOf = (amount: number) => (accountSize > 0 ? Math.round((amount / accountSize) * 10000) / 100 : 0)
  const amountFromPct = (pct: number | null) => (pct != null && accountSize > 0 ? Math.round(accountSize * pct) / 100 : null)

  const profitTargetAmount = optional("profitTargetAmount") ?? amountFromPct(optional("profitTargetPct"))
  const maxDrawdownAmount = optional("maxDrawdownAmount") ?? amountFromPct(optional("maxDrawdownPct"))
  if (!maxDrawdownAmount || maxDrawdownAmount <= 0) throw new Error("Max drawdown is required")
  const dailyLossLimitAmount = optional("dailyLossLimitAmount") ?? amountFromPct(optional("dailyLossLimitPct"))
  const drawdownType = String(formData.get("drawdownType") ?? "trailing") === "static" ? "static" : "trailing"

  return {
    profitTargetAmount,
    profitTargetPct: profitTargetAmount != null ? pctOf(profitTargetAmount) : null,
    maxDrawdownAmount,
    maxDrawdownPct: pctOf(maxDrawdownAmount),
    drawdownType,
    dailyLossLimitAmount,
    dailyLossLimitPct: dailyLossLimitAmount != null ? pctOf(dailyLossLimitAmount) : null,
    minTradingDays: optional("minTradingDays"),
    consistencyPct: optional("consistencyPct"),
    minPayoutDays: optional("minPayoutDays"),
    minDayProfit: optional("minDayProfit"),
    payoutCap: optional("payoutCap"),
  }
}

export async function savePropFirmRules(accountId: number, formData: FormData) {
  const userId = await getUserId()
  const [account] = await db
    .select({ id: tradingAccounts.id, startingBalance: tradingAccounts.startingBalance, startingBalanceInferred: tradingAccounts.startingBalanceInferred })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, userId)))
  if (!account) throw new Error("Account not found")

  const firmNameRaw = String(formData.get("firmName") ?? "").trim()
  const firmName = firmNameRaw !== "" ? firmNameRaw : null
  const planTypeRaw = String(formData.get("planType") ?? "").trim()
  const planType = planTypeRaw !== "" ? planTypeRaw : null
  const phase = String(formData.get("phase") ?? "evaluation")

  // The account size can be corrected here too — an account created by a
  // broker sync before its balance was known has none.
  const sizeRaw = formData.get("startingBalance")
  const startingBalance = sizeRaw != null && String(sizeRaw).trim() !== "" ? Number(sizeRaw) : Number(account.startingBalance)
  if (startingBalance > 0 && (startingBalance !== Number(account.startingBalance) || account.startingBalanceInferred)) {
    await db.update(tradingAccounts).set({ startingBalance: String(startingBalance), startingBalanceInferred: false }).where(eq(tradingAccounts.id, accountId))
  }

  const columns = ruleColumns(parseRuleFields(formData, startingBalance))

  const [existing] = await db.select().from(propFirmRules).where(eq(propFirmRules.accountId, accountId))
  if (existing) {
    await db
      .update(propFirmRules)
      .set({ firmName, planType, phase, ...columns, autoDetected: false })
      .where(eq(propFirmRules.id, existing.id))
  } else {
    await db.insert(propFirmRules).values({ accountId, userId, firmName, planType, phase, ...columns, autoDetected: false })
  }

  revalidatePath("/propfirm")
  revalidatePath("/dashboard")
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
export async function createManualPropFirmAccount(formData: FormData): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const userId = await getUserId()

  // This creates a trading account too, so Essential's account cap applies
  // (lib/plan-limits.ts).
  const limit = await accountLimitError(userId)
  if (limit) return { ok: false, error: limit }

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

  const columns = ruleColumns(parseRuleFields(formData, startingBalance))

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
    ...columns,
    openingBalanceAdjustment: openingBalanceAdjustment != null ? String(openingBalanceAdjustment) : null,
    autoDetected: false,
  })

  revalidatePath("/propfirm")
  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/settings")

  return { ok: true, id: account.id }
}
