// Provider rules: what a broker or prop firm lets a copier do with its
// accounts. One rule set per provider, versioned. The connection forms, the
// copy engine and the admin pages all ask lib/compliance/engine.ts, which reads
// these; so a provider's rules are data here, and nowhere a condition in the
// code. A provider with no rule set has no rules of its own to apply.
//
// The sets below are what applies until an administrator publishes a newer
// version (provider_rule_sets, lib/compliance/server.ts). They say what the
// provider's own pages say on the date given, and are not a promise about what
// the provider will do: the trader stays answerable to the provider's terms.

export type Permission = "allowed" | "blocked"

export type ProviderRules = {
  // TradeLoop reaching the account from its own servers, which is how every
  // MetaTrader connection is made (worker/mt5). "approval_required": the
  // provider forbids access from a server (a VPS, to it) and has not approved ours.
  cloudConnection: "allowed" | "approval_required"
  // what a Master (Leader) connection may be made with
  masterCredential: "investor_only" | "any"
  // TradeLoop placing orders on the provider's accounts
  execution: Permission
  // the provider's account leads, an account elsewhere follows
  toExternal: Permission
  // an account elsewhere leads, the provider's account follows
  fromExternal: Permission
  // both accounts at the provider, the same person's
  ownToOwn: Permission
  // both accounts at the provider, different people's
  crossUser: Permission
  // own-to-own only once the two accounts are known to be one person's
  ownershipProof: "required" | "not_required"
  // third-party EAs on the account: told to the trader, not enforced here
  thirdPartyEa: "allowed" | "restricted" | "blocked"
  // the most a trader may hold across the provider's accounts, in account currency
  maxAllocation: number | null
  // account-type restrictions and the like, in words
  notes: string[]
}

export type ProviderRuleSet = {
  provider: string // the key: "fundingpips"
  name: string
  version: number
  effectiveDate: string // YYYY-MM-DD
  // "disabled": the integration is switched off for everyone
  status: "active" | "disabled"
  // How its accounts are recognised: parts of a MetaTrader server name, compared
  // with everything but letters and digits removed ("FundingPips2-SIM").
  servers: string[]
  // the provider's own pages these rules were read from
  sources: { label: string; url: string }[]
  rules: ProviderRules
  // what the provider offers itself, where a trader is sent when TradeLoop can't act
  ownCopier: { name: string; url: string } | null
  // TradeLoop's own guide for this provider, a path in the Help Center
  guide: string | null
  // why this version was published
  note: string
}

// FundingPips. Trading Conduct and Security Standards (edited 19 Aug 2026) and
// Trade Copier (edited 10 Sep 2026), read 7 Oct 2026; and its support's written
// answer of that day: "using a VPS or VPN for the setup is not permitted, and
// using the investor password does not override this restriction", "copying
// trades onward from an external follower account into a FundingPips account
// using another tool is not permitted". Its MT5 servers, from its help pages:
// FundingPips-Trial, -Prime, -SIM, -SIM1 and FundingPips2-SIM.
export const FUNDINGPIPS_V1: ProviderRuleSet = {
  provider: "fundingpips",
  name: "FundingPips",
  version: 1,
  effectiveDate: "2026-10-07",
  status: "active",
  servers: ["fundingpips"],
  sources: [
    { label: "Trading Conduct and Security Standards", url: "https://help.fundingpips.com/hc/en-us/articles/34505029138449-Trading-Conduct-and-Security-Standards" },
    { label: "Trade Copier", url: "https://help.fundingpips.com/hc/en-us/articles/49580068780817-Trade-Copier" },
  ],
  rules: {
    cloudConnection: "approval_required",
    masterCredential: "investor_only",
    // an order needs the main password, on a server: both are what it forbids
    execution: "blocked",
    toExternal: "allowed",
    fromExternal: "blocked",
    ownToOwn: "allowed",
    crossUser: "blocked",
    ownershipProof: "required",
    thirdPartyEa: "restricted",
    // from its support's chat with a trader, not from its pages
    maxAllocation: 400_000,
    notes: [
      "Third-party EAs may only manage trades or risk; an EA of the trader's own may trade.",
      "1K Instant accounts allow third-party EAs and trade copiers.",
      "Monthly Competition accounts allow no EA at all.",
      "Opposite positions across accounts (hedging between accounts) are prohibited.",
    ],
  },
  ownCopier: { name: "FundingPips' Trade Copier", url: "https://help.fundingpips.com/hc/en-us/articles/49580068780817-Trade-Copier" },
  guide: "/connecting-accounts/fundingpips",
  note: "FundingPips' published rules, and its support's written answer of 7 Oct 2026.",
}

export const BUILT_IN_RULE_SETS: ProviderRuleSet[] = [FUNDINGPIPS_V1]

const PERMISSIONS: Permission[] = ["allowed", "blocked"]
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null)

// A rule set as an administrator typed it, checked: anything that isn't one of
// the values above is refused, never guessed at. Returns the problem in words.
export function cleanRuleSet(raw: unknown, base: ProviderRuleSet): ProviderRuleSet | string {
  const r = (raw ?? {}) as Partial<ProviderRuleSet> & { rules?: Partial<ProviderRules> }
  const rules: Partial<ProviderRules> = r.rules ?? {}
  const cloudConnection = oneOf(rules.cloudConnection, ["allowed", "approval_required"] as const)
  const masterCredential = oneOf(rules.masterCredential, ["investor_only", "any"] as const)
  const execution = oneOf(rules.execution, PERMISSIONS)
  const toExternal = oneOf(rules.toExternal, PERMISSIONS)
  const fromExternal = oneOf(rules.fromExternal, PERMISSIONS)
  const ownToOwn = oneOf(rules.ownToOwn, PERMISSIONS)
  const crossUser = oneOf(rules.crossUser, PERMISSIONS)
  const ownershipProof = oneOf(rules.ownershipProof, ["required", "not_required"] as const)
  const thirdPartyEa = oneOf(rules.thirdPartyEa, ["allowed", "restricted", "blocked"] as const)
  const status = oneOf(r.status, ["active", "disabled"] as const)
  if (!cloudConnection || !masterCredential || !execution || !toExternal || !fromExternal || !ownToOwn || !crossUser || !ownershipProof || !thirdPartyEa || !status) return "One of the rules has a value that isn't an option."
  const maxAllocation = rules.maxAllocation == null || (rules.maxAllocation as unknown) === "" ? null : Number(rules.maxAllocation)
  if (maxAllocation != null && !(Number.isFinite(maxAllocation) && maxAllocation > 0)) return "The maximum allocation must be a positive number, or empty."
  const effectiveDate = String(r.effectiveDate ?? "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(effectiveDate))) return "The effective date must be a date (YYYY-MM-DD)."
  const sources = (Array.isArray(r.sources) ? r.sources : []).map((s) => ({ label: String(s?.label ?? "").trim().slice(0, 120), url: String(s?.url ?? "").trim() })).filter((s) => s.label || s.url)
  if (sources.some((s) => !s.label || !/^https:\/\/[^\s]+$/.test(s.url))) return "Each source needs a name and an https:// address."
  if (!sources.length) return "Give at least one source: the provider's own page these rules were read from."
  const notes = (Array.isArray(rules.notes) ? rules.notes : []).map((n) => String(n ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 12)
  const note = String(r.note ?? "").trim().slice(0, 500)
  if (note.length < 10) return "Say why this version is published (at least a sentence)."
  // an order can't be sent to an account TradeLoop may not reach
  if (execution === "allowed" && cloudConnection !== "allowed") return "Orders can't be allowed while the connection from TradeLoop's servers is not."
  return {
    // what the provider is, and how its accounts are recognised, don't change with a version
    provider: base.provider,
    name: base.name,
    servers: base.servers,
    ownCopier: base.ownCopier,
    guide: base.guide,
    version: base.version + 1,
    effectiveDate,
    status,
    sources,
    rules: { cloudConnection, masterCredential, execution, toExternal, fromExternal, ownToOwn, crossUser, ownershipProof, thirdPartyEa, maxAllocation, notes },
    note,
  }
}
