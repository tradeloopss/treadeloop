import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { copyEvents, metatraderConnections, providerRuleSets } from "@/lib/db/schema"
import { BUILT_IN_RULE_SETS, cleanRuleSet, type ProviderRuleSet } from "./rules"
import { detectProvider, type Party, type Verdict } from "./engine"

// The rule sets in force, and the facts about an account the engine is handed.
// For each provider the newest published version (provider_rule_sets), or the
// one built into rules.ts until an administrator has published any.

// Asked on every connect and every pass of the copy engine: kept for a few
// seconds. A new version published elsewhere is in force here within that.
const TTL_MS = 10_000
let cached: { at: number; sets: ProviderRuleSet[] } | null = null

export async function ruleSets(): Promise<ProviderRuleSet[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.sets
  const rows = await db.select({ provider: providerRuleSets.provider, ruleSet: providerRuleSets.ruleSet }).from(providerRuleSets).orderBy(desc(providerRuleSets.version))
  const newest = new Map<string, ProviderRuleSet>()
  for (const r of rows) if (!newest.has(r.provider)) newest.set(r.provider, r.ruleSet)
  const sets = BUILT_IN_RULE_SETS.map((b) => newest.get(b.provider) ?? b)
  cached = { at: Date.now(), sets }
  return sets
}

export async function ruleSetFor(server: string | null | undefined): Promise<ProviderRuleSet | null> {
  return detectProvider(await ruleSets(), server)
}

export type PublishedVersion = { version: number; ruleSet: ProviderRuleSet; publishedByEmail: string; createdAt: Date }

// Every version of a provider's rules, newest first; the built-in one last.
export async function ruleSetHistory(provider: string): Promise<PublishedVersion[]> {
  const rows = await db.select().from(providerRuleSets).where(eq(providerRuleSets.provider, provider)).orderBy(desc(providerRuleSets.version))
  const builtIn = BUILT_IN_RULE_SETS.find((b) => b.provider === provider)
  return [...rows.map((r) => ({ version: r.version, ruleSet: r.ruleSet, publishedByEmail: r.publishedByEmail, createdAt: r.createdAt })), ...(builtIn ? [{ version: builtIn.version, ruleSet: builtIn, publishedByEmail: "TradeLoop", createdAt: new Date(`${builtIn.effectiveDate}T00:00:00Z`) }] : [])]
}

// A new version of a provider's rules. It is checked as typed, numbered after
// the one in force, and stored beside the others; nothing is overwritten.
export async function publishRuleSet(actor: { id: string; email: string }, provider: string, raw: unknown): Promise<{ before: ProviderRuleSet; after: ProviderRuleSet }> {
  cached = null
  const before = (await ruleSets()).find((s) => s.provider === provider)
  if (!before) throw new Error("That provider has no rules profile.")
  const after = cleanRuleSet(raw, before)
  if (typeof after === "string") throw new Error(after)
  // two administrators publishing at once: the second is told, not merged
  const [row] = await db.insert(providerRuleSets).values({ provider, version: after.version, ruleSet: after, publishedById: actor.id, publishedByEmail: actor.email }).onConflictDoNothing().returning({ id: providerRuleSets.id })
  if (!row) throw new Error("Someone else has just published a version of these rules. Reload and look at it first.")
  cached = null
  return { before, after }
}

// What changed between two versions, for the audit log: rule by rule.
export function ruleChanges(before: ProviderRuleSet, after: ProviderRuleSet): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  if (before.status !== after.status) changes.status = { from: before.status, to: after.status }
  for (const key of Object.keys(after.rules) as (keyof ProviderRuleSet["rules"])[]) {
    if (JSON.stringify(before.rules[key]) !== JSON.stringify(after.rules[key])) changes[key] = { from: before.rules[key], to: after.rules[key] }
  }
  return changes
}

// The accounts of a user as the engine sees them: each one's provider, and
// whether its broker login is also connected by another TradeLoop user (two
// people on one login is not one person's own accounts).
export async function parties(userId: string, accountIds: number[]): Promise<Map<number, Party>> {
  const out = new Map<number, Party>()
  const unique = [...new Set(accountIds)]
  if (!unique.length) return out
  const sets = await ruleSets()
  const rows = await db.select({ accountId: metatraderConnections.accountId, login: metatraderConnections.login, server: metatraderConnections.server }).from(metatraderConnections).where(and(eq(metatraderConnections.userId, userId), inArray(metatraderConnections.accountId, unique)))
  for (const id of unique) out.set(id, { set: null })
  for (const r of rows) {
    if (r.accountId == null) continue
    const set = detectProvider(sets, r.server)
    if (!set) continue
    const [other] = await db.select({ n: sql<number>`count(*)::int` }).from(metatraderConnections).where(and(eq(metatraderConnections.login, r.login), eq(metatraderConnections.server, r.server), ne(metatraderConnections.userId, userId)))
    // Nothing here can show two accounts to be one person's: no provider offers
    // a check, and a name on an account is not proof. So it is never assumed.
    out.set(r.accountId, { set, ownerVerified: false, sharedLogin: (other?.n ?? 0) > 0 })
  }
  return out
}

// A refusal, kept where the trader sees their copy activity and where an
// administrator counts them. Never the reason an action fails twice.
export async function recordBlock(userId: string, verdict: Extract<Verdict, { allowed: false }>, where: { groupId?: number | null; accountId?: number | null; action: string }): Promise<void> {
  await db
    .insert(copyEvents)
    .values({ userId, groupId: where.groupId ?? null, accountId: where.accountId ?? null, level: "warning", code: "compliance_blocked", title: `${verdict.provider}: not permitted`, body: verdict.message, data: { provider: verdict.provider, reasonCode: verdict.reasonCode, action: where.action } })
    .catch(() => {})
}

// What a refusal is thrown as: the sentence, and the code with it.
export class ComplianceError extends Error {
  verdict: Extract<Verdict, { allowed: false }>
  constructor(verdict: Extract<Verdict, { allowed: false }>) {
    super(verdict.message)
    this.name = "ComplianceError"
    this.verdict = verdict
  }
}
