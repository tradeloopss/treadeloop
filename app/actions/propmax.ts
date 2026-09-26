"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { assertAdmin } from "@/lib/admin/guard"
import { tradingAccounts, propAccount, propFirm, propProgram, propRuleVersion } from "@/lib/db/schema"
import { getPropMaxOverview, type PropMaxAccountView } from "@/lib/propmax/account"
import { seedPropmaxCatalog } from "@/lib/propmax/seed"
import type { CatalogOption, PropMaxData } from "@/lib/propmax/view-types"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getPropMaxData(): Promise<PropMaxData> {
  const userId = await getUserId()
  const [accounts, firms, programs, versions] = await Promise.all([
    getPropMaxOverview(userId),
    db.select({ id: propFirm.id, slug: propFirm.slug, name: propFirm.name }).from(propFirm),
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
      programSlug: program.slug,
      programName: program.name,
      accountSize: v.accountSize,
      phase: v.phase,
      confidence: v.confidence,
      sourceName: v.sourceName,
    })
  }
  // Stable order for the picker: firm, program, size, phase.
  catalog.sort(
    (a, b) =>
      a.firmName.localeCompare(b.firmName) ||
      a.programName.localeCompare(b.programName) ||
      (a.accountSize ?? 0) - (b.accountSize ?? 0) ||
      a.phase.localeCompare(b.phase),
  )

  return { accounts, catalog }
}

// One account's detail (its evaluation) plus the catalog, for the detail page
// and its "change rules" picker.
export async function getPropMaxAccountDetail(accountId: number): Promise<{ account: PropMaxAccountView | null; catalog: CatalogOption[] }> {
  const { accounts, catalog } = await getPropMaxData()
  return { account: accounts.find((a) => a.accountId === accountId) ?? null, catalog }
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
  return result
}
