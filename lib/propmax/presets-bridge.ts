// Bridges the researched futures-firm presets (lib/propfirm-presets.ts) into
// the PropFirm Max engine's vocabulary and into normalized catalog rows.
//
// The presets are the ONE researched source of prop-firm numbers in the
// codebase; PropFirm Max doesn't invent its own. This module is the single
// translation layer: preset → RuleConfig[] the engine evaluates, and preset →
// {firm, program, rule_version} rows the catalog stores. Every produced rule
// set carries its source and confidence, so nothing is presented as a verified
// rule that we can't point to a source for.
import {
  PROP_FIRM_PRESETS,
  presetSizes,
  resolvePresetRules,
  type PropFirmPreset,
  type ResolvedRules,
} from "@/lib/propfirm-presets"
import type { RuleConfig, RuleSource } from "@/lib/propmax/types"
import type { RuleSet } from "@/lib/propmax/engine"

// The account sizes to seed for a firm that doesn't publish exact per-size
// figures — its percentages hold across sizes, so we materialize the common
// ones as concrete currency rule sets the user can pick from. Futures firms
// sell 25K–150K; forex/CFD firms sell 10K–200K, so each asset class gets its
// own default ladder (picked by preset.assetClass in buildCatalogSeed).
export const DEFAULT_SIZES = [25_000, 50_000, 100_000, 150_000]
export const DEFAULT_SIZES_FOREX = [10_000, 25_000, 50_000, 100_000, 200_000]

// The default account-size ladder for a preset that lists no exact sizes.
export function defaultSizesFor(assetClass: string): number[] {
  return assetClass === "forex" ? DEFAULT_SIZES_FOREX : DEFAULT_SIZES
}

// The phases a preset has rules for. "funded" only when the preset defines it.
export function presetPhases(preset: PropFirmPreset): string[] {
  return preset.funded ? ["evaluation", "funded"] : ["evaluation"]
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Turn one account size + phase of a preset into the engine's rule configs.
// Amounts are the exact dollar thresholds resolvePresetRules produced for this
// size, so nothing is re-derived or rounded a second time. A rule the firm
// doesn't have is simply omitted (the engine treats an absent rule as
// not_applicable — never a false "safe").
export function presetToRuleConfigs(resolved: ResolvedRules): RuleConfig[] {
  const rules: RuleConfig[] = []

  // Max drawdown — the account-ending line. Always present.
  rules.push({
    type: "max_drawdown",
    unit: "currency",
    value: resolved.maxDrawdownAmount,
    model: resolved.drawdownType, // trailing | static
    severity: "account_failure",
  })

  if (resolved.profitTargetAmount != null) {
    rules.push({ type: "profit_target", unit: "currency", value: resolved.profitTargetAmount })
  }

  if (resolved.dailyLossLimitAmount != null) {
    rules.push({ type: "max_daily_loss", unit: "currency", value: resolved.dailyLossLimitAmount, severity: "soft_breach" })
  }

  if (resolved.minTradingDays != null) {
    rules.push({ type: "min_trading_days", unit: "days", value: resolved.minTradingDays })
  }

  if (resolved.consistencyPct != null) {
    rules.push({ type: "consistency", unit: "percentage", value: resolved.consistencyPct })
  }

  return rules
}

// The provenance stamped on every rule set built from a preset. The presets
// were researched from each firm's own published rules (Sept 2026); confidence
// is "high" where the firm publishes exact per-size figures (we used them
// verbatim) and "medium" where we scaled a representative percentage.
export function presetSource(preset: PropFirmPreset, resolved: ResolvedRules): RuleSource {
  return {
    name: `${preset.firm} — published rules`,
    type: "official_rules",
    verifiedAt: preset.verifiedAt ?? "2026-09-27",
    confidence: resolved.exactSize ? "high" : "medium",
  }
}

// A preset (at a given size + phase) as the engine's RuleSet — rules + source.
export function presetToRuleSet(preset: PropFirmPreset, accountSize: number, phase: string): RuleSet {
  const resolved = resolvePresetRules(preset, accountSize, phase)
  return {
    rules: presetToRuleConfigs(resolved),
    source: presetSource(preset, resolved),
    versionLabel: `${preset.program} · ${phase} · $${accountSize.toLocaleString()}`,
  }
}

// --- Catalog seed (normalized rows) ----------------------------------------

export interface SeedFirm {
  slug: string
  name: string
  assetClass: string
}
export interface SeedProgram {
  firmSlug: string
  slug: string
  name: string
  assetClass: string
}
export interface SeedRuleVersion {
  firmSlug: string
  programSlug: string
  accountSize: number
  phase: string
  version: number
  rules: RuleConfig[]
  sourceName: string
  sourceUrl: string | null
  sourceType: string
  confidence: string
  verifiedAt: string | null
  caveat: string | null
}

export interface CatalogSeed {
  firms: SeedFirm[]
  programs: SeedProgram[]
  versions: SeedRuleVersion[]
}

// Build the whole normalized catalog from the presets — pure, deterministic,
// no DB. lib/propmax/seed.ts upserts these; tests assert them directly.
export function buildCatalogSeed(presets: PropFirmPreset[] = PROP_FIRM_PRESETS): CatalogSeed {
  const firms = new Map<string, SeedFirm>()
  const programs = new Map<string, SeedProgram>()
  const versions: SeedRuleVersion[] = []

  for (const preset of presets) {
    const assetClass = preset.assetClass ?? "futures"
    const firmSlug = slugify(preset.firm)
    if (!firms.has(firmSlug)) firms.set(firmSlug, { slug: firmSlug, name: preset.firm, assetClass })

    const programSlug = slugify(preset.program)
    const programKey = `${firmSlug}/${programSlug}`
    if (!programs.has(programKey)) {
      programs.set(programKey, { firmSlug, slug: programSlug, name: preset.program, assetClass })
    }

    const sizes = presetSizes(preset)
    const sizesToSeed = sizes.length > 0 ? sizes : defaultSizesFor(assetClass)
    for (const phase of presetPhases(preset)) {
      for (const accountSize of sizesToSeed) {
        const resolved = resolvePresetRules(preset, accountSize, phase)
        const source = presetSource(preset, resolved)
        versions.push({
          firmSlug,
          programSlug,
          accountSize,
          phase,
          version: 1,
          rules: presetToRuleConfigs(resolved),
          sourceName: source.name,
          sourceUrl: preset.sourceUrl ?? null,
          sourceType: source.type,
          confidence: source.confidence,
          verifiedAt: source.verifiedAt ?? null,
          caveat: preset.notes,
        })
      }
    }
  }

  return { firms: [...firms.values()], programs: [...programs.values()], versions }
}
