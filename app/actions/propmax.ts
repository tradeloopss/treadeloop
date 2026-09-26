"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, desc, eq, isNull } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { assertAdmin } from "@/lib/admin/guard"
import { tradingAccounts, propAccount, propFirm, propProgram, propRuleVersion, propSnapshot, propAlert, propFirmTransactions } from "@/lib/db/schema"
import { getPropMaxOverview, type PropMaxAccountView } from "@/lib/propmax/account"
import { seedPropmaxCatalog } from "@/lib/propmax/seed"
import { deriveAlerts, buildSnapshot } from "@/lib/propmax/alerts"
import { getAccountOpenPositions } from "@/app/actions/trade-manager"
import type { OpenTradeView } from "@/lib/trade-manager"
import type { RuleConfig, RuleType } from "@/lib/propmax/types"
import type { CatalogOption, PropMaxData, PropMaxAlertView, PropMaxDailyRow, PropMaxPayoutRow } from "@/lib/propmax/view-types"

// Build the setup-picker catalog: only firm/program/size/phase combos with an
// in-force, sourced rule version.
async function buildCatalog(): Promise<CatalogOption[]> {
  const [firms, programs, versions] = await Promise.all([
    db.select({ id: propFirm.id, slug: propFirm.slug, name: propFirm.name, assetClass: propFirm.assetClass }).from(propFirm),
    db.select({ id: propProgram.id, firmId: propProgram.firmId, slug: propProgram.slug, name: propProgram.name }).from(propProgram),
    db
      .select({
        id: propRuleVersion.id,
        programId: propRuleVersion.programId,
        accountSize: propRuleVersion.accountSize,
        phase: propRuleVersion.phase,
        confidence: propRuleVersion.confidence,
        sourceName: propRuleVersion.sourceName,
      })
      .from(propRuleVersion)
      .where(isNull(propRuleVersion.effectiveTo)),
  ])

  const firmById = new Map(firms.map((f) => [f.id, f]))
  const programById = new Map(programs.map((p) => [p.id, p]))
  const catalog: CatalogOption[] = []
  for (const v of versions) {
    const program = programById.get(v.programId)
    if (!program) continue
    const firm = firmById.get(program.firmId)
    if (!firm) continue
    catalog.push({
      id: v.id,
      firmSlug: firm.slug,
      firmName: firm.name,
      assetClass: firm.assetClass ?? "futures",
      programSlug: program.slug,
      programName: program.name,
      accountSize: v.accountSize,
      phase: v.phase,
      confidence: v.confidence,
      sourceName: v.sourceName,
    })
  }
  catalog.sort(
    (a, b) =>
      a.firmName.localeCompare(b.firmName) ||
      a.programName.localeCompare(b.programName) ||
      (a.accountSize ?? 0) - (b.accountSize ?? 0) ||
      a.phase.localeCompare(b.phase),
  )
  return catalog
}

// Record today's snapshot for each bound account and fire any new
// threshold-crossing alerts. Idempotent: the snapshot upserts on
// (propAccountId, date) and each alert's unique dedupeKey means a level that's
// already been alerted today is skipped. Mirrors the codebase's pattern of
// letting a read action persist derived state (see getPropFirmAccounts).
async function persistState(userId: string, accounts: PropMaxAccountView[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const snapshots = accounts.map((a) => buildSnapshot(a, userId, today)).filter((s): s is NonNullable<typeof s> => s != null)
  const alerts = accounts.flatMap((a) => deriveAlerts(a, userId, today))

  for (const s of snapshots) {
    await db
      .insert(propSnapshot)
      .values(s)
      .onConflictDoUpdate({
        target: [propSnapshot.propAccountId, propSnapshot.date],
        set: { balance: s.balance, equity: s.equity, highWaterMark: s.highWaterMark, riskStatus: s.riskStatus, evaluation: s.evaluation },
      })
  }
  for (const a of alerts) {
    await db
      .insert(propAlert)
      .values({
        propAccountId: a.propAccountId,
        userId: a.userId,
        ruleType: a.ruleType,
        status: a.status,
        severity: a.severity,
        title: a.title,
        body: a.body,
        percentageUsed: a.percentageUsed != null ? String(a.percentageUsed) : null,
        dedupeKey: a.dedupeKey,
      })
      .onConflictDoNothing({ target: propAlert.dedupeKey })
  }
}

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getPropMaxData(): Promise<PropMaxData> {
  const userId = await getUserId()
  const [accounts, catalog] = await Promise.all([getPropMaxOverview(userId), buildCatalog()])
  // Record snapshots + fire alerts off this fresh evaluation (idempotent).
  await persistState(userId, accounts)
  return { accounts, catalog }
}

// One account's detail (its evaluation) plus the catalog + its open positions,
// for the detail page. Read-only (no snapshot/alert writes here — the main
// page's load already did that).
export async function getPropMaxAccountDetail(accountId: number): Promise<{
  account: PropMaxAccountView | null
  catalog: CatalogOption[]
  positions: OpenTradeView[]
  alerts: PropMaxAlertView[]
  daily: PropMaxDailyRow[]
  payouts: PropMaxPayoutRow[]
}> {
  const userId = await getUserId()
  const [accounts, catalog, positions, alerts] = await Promise.all([
    getPropMaxOverview(userId),
    buildCatalog(),
    getAccountOpenPositions(accountId),
    getPropMaxAlerts(),
  ])
  const account = accounts.find((a) => a.accountId === accountId) ?? null

  const num = (v: string | null) => (v != null ? Number(v) : null)
  const daily: PropMaxDailyRow[] = account?.propAccountId
    ? (
        await db
          .select({ date: propSnapshot.date, balance: propSnapshot.balance, equity: propSnapshot.equity, highWaterMark: propSnapshot.highWaterMark, riskStatus: propSnapshot.riskStatus })
          .from(propSnapshot)
          .where(and(eq(propSnapshot.propAccountId, account.propAccountId), eq(propSnapshot.userId, userId)))
          .orderBy(desc(propSnapshot.date))
          .limit(120)
      ).map((r) => ({ date: r.date, balance: num(r.balance), equity: num(r.equity), highWaterMark: num(r.highWaterMark), riskStatus: r.riskStatus }))
    : []

  const payouts: PropMaxPayoutRow[] = (
    await db
      .select({ id: propFirmTransactions.id, type: propFirmTransactions.type, category: propFirmTransactions.category, amount: propFirmTransactions.amount, occurredAt: propFirmTransactions.occurredAt, note: propFirmTransactions.note })
      .from(propFirmTransactions)
      .where(and(eq(propFirmTransactions.userId, userId), eq(propFirmTransactions.accountId, accountId)))
      .orderBy(desc(propFirmTransactions.occurredAt))
  ).map((r) => ({ id: r.id, type: r.type, category: r.category, amount: Number(r.amount), occurredAt: r.occurredAt.toISOString(), note: r.note }))

  return { account, catalog, positions, alerts: alerts.filter((a) => a.accountId === accountId), daily, payouts }
}

// The user's unacknowledged alerts, newest first, for the alert center.
export async function getPropMaxAlerts(): Promise<PropMaxAlertView[]> {
  const userId = await getUserId()
  const rows = await db
    .select({
      id: propAlert.id,
      accountId: propAccount.accountId,
      accountName: tradingAccounts.name,
      ruleType: propAlert.ruleType,
      status: propAlert.status,
      severity: propAlert.severity,
      title: propAlert.title,
      body: propAlert.body,
      percentageUsed: propAlert.percentageUsed,
      createdAt: propAlert.createdAt,
    })
    .from(propAlert)
    .leftJoin(propAccount, eq(propAlert.propAccountId, propAccount.id))
    .leftJoin(tradingAccounts, eq(propAccount.accountId, tradingAccounts.id))
    .where(and(eq(propAlert.userId, userId), isNull(propAlert.acknowledgedAt)))
    .orderBy(desc(propAlert.createdAt))
    .limit(50)

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId ?? null,
    accountName: r.accountName ?? "Account",
    ruleType: r.ruleType,
    status: r.status,
    severity: r.severity,
    title: r.title,
    body: r.body,
    percentageUsed: r.percentageUsed != null ? Number(r.percentageUsed) : null,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function acknowledgePropMaxAlert(alertId: number) {
  const userId = await getUserId()
  await db.update(propAlert).set({ acknowledgedAt: new Date() }).where(and(eq(propAlert.id, alertId), eq(propAlert.userId, userId)))
  revalidatePath("/propfirm-max")
}

export async function acknowledgeAllPropMaxAlerts() {
  const userId = await getUserId()
  await db.update(propAlert).set({ acknowledgedAt: new Date() }).where(and(eq(propAlert.userId, userId), isNull(propAlert.acknowledgedAt)))
  revalidatePath("/propfirm-max")
}

// Bind one of the user's accounts to a specific, existing rule version. The
// client passes a versionId it picked from the catalog, so there's no
// re-resolution or guessing here — we just verify it exists and pin it.
export async function setupPropMaxAccount(input: { accountId: number; ruleVersionId: number }) {
  const userId = await getUserId()

  // The account must be the user's own.
  const [account] = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, input.accountId), eq(tradingAccounts.userId, userId)))
  if (!account) throw new Error("Account not found.")

  const [version] = await db
    .select({ id: propRuleVersion.id, programId: propRuleVersion.programId, accountSize: propRuleVersion.accountSize, phase: propRuleVersion.phase })
    .from(propRuleVersion)
    .where(eq(propRuleVersion.id, input.ruleVersionId))
  if (!version) throw new Error("Those rules no longer exist — pick again.")

  const [program] = await db
    .select({ id: propProgram.id, firmId: propProgram.firmId })
    .from(propProgram)
    .where(eq(propProgram.id, version.programId))
  if (!program) throw new Error("Program not found.")

  const now = new Date()
  const values = {
    userId,
    accountId: input.accountId,
    firmId: program.firmId,
    programId: program.id,
    ruleVersionId: version.id,
    accountSize: version.accountSize,
    phase: version.phase,
    detectionSource: "manual" as const,
    detectionConfidence: "high" as const,
    confirmed: true,
    updatedAt: now,
  }

  await db
    .insert(propAccount)
    .values(values)
    .onConflictDoUpdate({ target: propAccount.accountId, set: values })

  revalidatePath("/propfirm-max")
}

// Stop tracking an account under PropFirm Max (removes the binding; the old
// /propfirm tracker and the account's trades are untouched).
export async function removePropMaxAccount(accountId: number) {
  const userId = await getUserId()
  await db.delete(propAccount).where(and(eq(propAccount.accountId, accountId), eq(propAccount.userId, userId)))
  revalidatePath("/propfirm-max")
}

// Admin-only: seed / refresh the firm + program + rule-version catalog from the
// researched presets. Idempotent — safe to run more than once.
export async function seedPropMaxCatalogAction() {
  await assertAdmin({ brokers: ["sync"] })
  const result = await seedPropmaxCatalog(db)
  revalidatePath("/propfirm-max")
  revalidatePath("/admin/prop-rules")
  return result
}

const RULE_TYPES = new Set<RuleType>([
  "max_daily_loss",
  "max_drawdown",
  "profit_target",
  "min_trading_days",
  "max_trading_days",
  "consistency",
  "max_position_size",
  "max_contracts",
  "max_open_positions",
  "inactivity",
  "weekend_holding",
  "news_restriction",
  "min_trade_duration",
])

// Admin-only: publish a new rule version for a (program, size, phase). This is
// the versioning workflow — the current in-force version is retired
// (effectiveTo = now) and a new one takes its place with a bumped version and a
// changeReason, so history is preserved and any account pinned to the old
// version keeps being judged by it. A source is mandatory: rules are never
// published without one.
export async function createPropRuleVersion(input: {
  programId: number
  accountSize: number | null
  phase: string
  rules: RuleConfig[]
  sourceName: string
  sourceUrl?: string | null
  sourceType?: string
  confidence?: string
  verifiedAt?: string | null
  changeReason?: string | null
  caveat?: string | null
}) {
  const admin = await assertAdmin({ brokers: ["sync"] })

  if (!input.sourceName?.trim()) throw new Error("A source is required — rules are never published without one.")
  const rules = (input.rules ?? []).filter((r) => RULE_TYPES.has(r.type) && (r.value == null || Number.isFinite(r.value)))
  if (rules.length === 0) throw new Error("Add at least one rule.")

  const [program] = await db.select({ id: propProgram.id }).from(propProgram).where(eq(propProgram.id, input.programId))
  if (!program) throw new Error("Program not found.")

  const now = new Date()
  const scope = and(
    eq(propRuleVersion.programId, input.programId),
    input.accountSize == null ? isNull(propRuleVersion.accountSize) : eq(propRuleVersion.accountSize, input.accountSize),
    eq(propRuleVersion.phase, input.phase),
  )

  // Retire the current in-force version for this scope, if any.
  await db.update(propRuleVersion).set({ effectiveTo: now }).where(and(scope, isNull(propRuleVersion.effectiveTo)))

  const prior = await db.select({ version: propRuleVersion.version }).from(propRuleVersion).where(scope).orderBy(desc(propRuleVersion.version)).limit(1)
  const version = (prior[0]?.version ?? 0) + 1

  await db.insert(propRuleVersion).values({
    programId: input.programId,
    accountSize: input.accountSize,
    phase: input.phase,
    version,
    rules,
    sourceName: input.sourceName.trim(),
    sourceUrl: input.sourceUrl?.trim() || null,
    sourceType: input.sourceType || "official_rules",
    confidence: input.confidence || "medium",
    verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : now,
    effectiveFrom: now,
    changeReason: input.changeReason?.trim() || null,
    caveat: input.caveat?.trim() || null,
    createdBy: admin.id,
  })

  revalidatePath("/admin/prop-rules")
  revalidatePath("/propfirm-max")
  return { version }
}
