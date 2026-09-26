// Idempotent seed of the PropFirm Max catalog (prop_firm / prop_program /
// prop_rule_version) from the researched presets. Safe to run repeatedly: it
// upserts firms and programs by their slug, and inserts a rule version only
// when there isn't already an in-force one for that (program, size, phase), so
// re-running never duplicates rows or silently rewrites a version an account
// is already pinned to. Editing rules is the admin rule-builder's job (Phase
// 7), not the seeder's.
import { and, eq, isNull } from "drizzle-orm"
import { db as sharedDb } from "@/lib/db"
import { propFirm, propProgram, propRuleVersion } from "@/lib/db/schema"
import { buildCatalogSeed } from "@/lib/propmax/presets-bridge"

type Db = typeof sharedDb

export interface SeedResult {
  firms: number
  programs: number
  versions: number // newly inserted rule versions
}

export async function seedPropmaxCatalog(db: Db = sharedDb): Promise<SeedResult> {
  const seed = buildCatalogSeed()
  const result: SeedResult = { firms: 0, programs: 0, versions: 0 }

  // Firms — upsert by slug.
  const firmIdBySlug = new Map<string, number>()
  for (const f of seed.firms) {
    const [row] = await db
      .insert(propFirm)
      .values({ slug: f.slug, name: f.name, assetClass: f.assetClass, updatedAt: new Date() })
      .onConflictDoUpdate({ target: propFirm.slug, set: { name: f.name, assetClass: f.assetClass, updatedAt: new Date() } })
      .returning({ id: propFirm.id })
    firmIdBySlug.set(f.slug, row.id)
    result.firms++
  }

  // Programs — upsert by (firmId, slug).
  const programIdByKey = new Map<string, number>()
  for (const p of seed.programs) {
    const firmId = firmIdBySlug.get(p.firmSlug)
    if (firmId == null) continue
    const [row] = await db
      .insert(propProgram)
      .values({ firmId, slug: p.slug, name: p.name, assetClass: p.assetClass, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [propProgram.firmId, propProgram.slug],
        set: { name: p.name, assetClass: p.assetClass, updatedAt: new Date() },
      })
      .returning({ id: propProgram.id })
    programIdByKey.set(`${p.firmSlug}/${p.slug}`, row.id)
    result.programs++
  }

  // Rule versions — insert only when no in-force version exists for this
  // (program, size, phase). Never supersedes an existing one (that's a rule
  // change, handled deliberately in admin, not on every deploy).
  for (const v of seed.versions) {
    const programId = programIdByKey.get(`${v.firmSlug}/${v.programSlug}`)
    if (programId == null) continue
    const existing = await db
      .select({ id: propRuleVersion.id })
      .from(propRuleVersion)
      .where(
        and(
          eq(propRuleVersion.programId, programId),
          v.accountSize == null ? isNull(propRuleVersion.accountSize) : eq(propRuleVersion.accountSize, v.accountSize),
          eq(propRuleVersion.phase, v.phase),
          isNull(propRuleVersion.effectiveTo),
        ),
      )
      .limit(1)
    if (existing.length > 0) continue

    await db.insert(propRuleVersion).values({
      programId,
      accountSize: v.accountSize,
      phase: v.phase,
      version: v.version,
      rules: v.rules,
      sourceName: v.sourceName,
      sourceUrl: v.sourceUrl,
      sourceType: v.sourceType,
      confidence: v.confidence,
      verifiedAt: v.verifiedAt ? new Date(v.verifiedAt) : null,
      caveat: v.caveat,
    })
    result.versions++
  }

  return result
}
