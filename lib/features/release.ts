// Feature releases: who can use a feature that is still being rolled out.
// Pure — lib/features/server.ts reads and writes the setting.
//
//   admin = only the team sees it (in the menu, on the pages, on the dashboard)
//   beta  = every signed-in user sees it, marked "Beta"
//
// A feature starts in "admin" and is moved to "beta" from the admin dashboard
// (Feature releases). Moving it back hides it from everyone but the team again;
// nothing anyone saved is lost.

export const FEATURES = [
  { key: "edge_lab", label: "Edge Lab", href: "/edge-lab", description: "Discovers, tests and monitors what makes a trader profitable." },
  { key: "psychology", label: "Psychology", href: "/psychology", description: "Shows how behaviour and state of mind change trading results." },
] as const

export type FeatureKey = (typeof FEATURES)[number]["key"]
export const FEATURE_KEYS = FEATURES.map((f) => f.key) as FeatureKey[]
export const isFeatureKey = (v: unknown): v is FeatureKey => typeof v === "string" && (FEATURE_KEYS as string[]).includes(v)
export const featureLabel = (key: FeatureKey) => FEATURES.find((f) => f.key === key)!.label

export const STAGES = ["admin", "beta"] as const
export type Stage = (typeof STAGES)[number]
export const isStage = (v: unknown): v is Stage => v === "admin" || v === "beta"
export const STAGE_LABELS: Record<Stage, string> = { admin: "Admin test only", beta: "Beta — all users" }

export type Releases = Record<FeatureKey, Stage>
export const DEFAULT_RELEASES: Releases = { edge_lab: "admin", psychology: "admin" }

// Whatever is stored, a feature is only ever in a known stage — and anything
// unreadable means "admin", never "released".
export function normalizeReleases(raw: unknown): Releases {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_RELEASES }
  for (const key of FEATURE_KEYS) if (isStage(r[key])) out[key] = r[key]
  return out
}

export const canUseFeature = (stage: Stage, isAdmin: boolean) => isAdmin || stage === "beta"
