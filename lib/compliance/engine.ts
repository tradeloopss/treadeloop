import type { ProviderRuleSet } from "./rules"

// The compliance engine: every question about what a provider allows is asked
// here, by the connection forms, the copy engine and the admin pages alike, and
// answered from the provider's rule set (rules.ts). Pure: the rule sets in
// force are handed in (lib/compliance/server.ts loads them).
//
// An answer is a verdict: allowed, or not, with the provider, a reason code a
// program can act on and a sentence a trader can read.

export type ReasonCode =
  | "INTEGRATION_DISABLED"
  | "CLOUD_CONNECTION_NOT_APPROVED"
  | "RISK_NOT_ACKNOWLEDGED"
  | "MASTER_CREDENTIAL"
  | "EXECUTION_BLOCKED"
  | "INBOUND_COPY_BLOCKED"
  | "OUTBOUND_COPY_BLOCKED"
  | "OWN_TO_OWN_BLOCKED"
  | "OWNERSHIP_UNVERIFIED"
  | "CROSS_USER_BLOCKED"
  // a strategy shared between people (lib/compliance/kind.ts, lib/copy/shares.ts)
  | "SHARED_LEADER_NOT_BROKER"
  | "SHARED_FOLLOWER_NOT_BROKER"
  | "SHARE_ENDED"

export type Verdict = { allowed: true; provider: string | null } | { allowed: false; provider: string; reasonCode: ReasonCode; message: string }

const ok = (set: ProviderRuleSet | null): Verdict => ({ allowed: true, provider: set?.name ?? null })
const no = (set: ProviderRuleSet, reasonCode: ReasonCode, message: string): Verdict => ({ allowed: false, provider: set.name, reasonCode, message })

// "FundingPips2-SIM", "Funding Pips - Live": the name however it is spaced
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

// The provider a MetaTrader server belongs to, if it is one with rules.
export function detectProvider(sets: ProviderRuleSet[], server: string | null | undefined): ProviderRuleSet | null {
  const name = plain(server ?? "")
  if (!name) return null
  return sets.find((s) => s.servers.some((part) => name.includes(plain(part)))) ?? null
}

// What a trader is told, and must accept, before an account is connected
// against its provider's rule on access from a server. Said plainly: it is the
// trader's account that is at stake.
export const riskNotice = (set: ProviderRuleSet) =>
  `${set.name} does not permit a trading account to be reached from a server (a VPS or VPN), even with the read-only password. TradeLoop connects from its own server, ${set.name} will see that login, and it can restrict or close an account for it. If you connect, you do so at your own risk.`

// May this account be connected at all, the way TradeLoop connects (from its
// servers), with this kind of password? Where the provider forbids a server
// and TradeLoop connects at the trader's own risk, only once the trader has
// accepted that risk (`acknowledged`).
export function validateConnection(set: ProviderRuleSet | null, how: { credential: "investor" | "trading"; acknowledged?: boolean }): Verdict {
  if (!set) return ok(null)
  if (set.status === "disabled") return no(set, "INTEGRATION_DISABLED", `${set.name} accounts can't be connected to TradeLoop at the moment.`)
  if (set.rules.cloudConnection === "own_risk" && !how.acknowledged) return no(set, "RISK_NOT_ACKNOWLEDGED", riskNotice(set))
  if (set.rules.cloudConnection === "approval_required")
    return no(set, "CLOUD_CONNECTION_NOT_APPROVED", `${set.name} accounts can't be connected to TradeLoop. ${set.name} doesn't allow a trading account to be reached from a server, even with the read-only password, and TradeLoop connects from its servers.`)
  if (how.credential === "trading" && (set.rules.masterCredential === "investor_only" || set.rules.execution === "blocked"))
    return no(set, "MASTER_CREDENTIAL", `${set.name} accounts are connected with the investor (read-only) password only. TradeLoop doesn't keep a trading password for one.`)
  return ok(set)
}

// An account that is already connected: its trader accepted the risk, where there was one, when connecting it.
const connected = (set: ProviderRuleSet | null) => validateConnection(set, { credential: "investor", acknowledged: true })

// May TradeLoop place an order on this account?
export function validateExecution(set: ProviderRuleSet | null): Verdict {
  if (!set) return ok(null)
  const connection = connected(set)
  if (!connection.allowed) return connection
  if (set.rules.execution === "blocked") return no(set, "EXECUTION_BLOCKED", `TradeLoop places no orders on ${set.name} accounts: ${set.name}'s rules don't allow it.`)
  return ok(set)
}

export type Party = {
  set: ProviderRuleSet | null
  // the account has been shown to be this trader's own, by the provider or by a check of ours
  ownerVerified?: boolean
  // the same broker login is also connected by another TradeLoop user
  sharedLogin?: boolean
}

const own = (set: ProviderRuleSet) => (set.ownCopier ? ` Use ${set.ownCopier.name} for that.` : "")

// May this Master's trades be copied to this Follower? The Master is read, the
// Follower is traded on: both ends are asked.
export function validateDirection(master: Party, follower: Party): Verdict {
  const m = master.set
  const f = follower.set
  // the Master must be an account TradeLoop may read
  const reading = connected(m)
  if (!reading.allowed) return reading
  if (f) {
    const connection = connected(f)
    if (m && m.provider === f.provider) {
      if (master.sharedLogin || follower.sharedLogin) {
        if (f.rules.crossUser === "blocked") return no(f, "CROSS_USER_BLOCKED", `${f.name} doesn't permit copying between accounts that belong to different people, and one of these accounts is also connected by another TradeLoop user.`)
      }
      if (f.rules.ownToOwn === "blocked") return no(f, "OWN_TO_OWN_BLOCKED", `${f.name} doesn't permit copying between its accounts.`)
      if (f.rules.ownershipProof === "required" && !(master.ownerVerified && follower.ownerVerified))
        return no(f, "OWNERSHIP_UNVERIFIED", `${f.name} permits copying between its accounts only when both belong to the same person, and TradeLoop has no way to confirm that for these two.${own(f)}`)
    } else if (f.rules.fromExternal === "blocked") {
      return no(f, "INBOUND_COPY_BLOCKED", `${f.name} does not permit this copy direction: nothing may be copied into a ${f.name} account from an account outside ${f.name}. Choose an external account as the Follower instead.`)
    }
    if (!connection.allowed) return connection
    const execution = validateExecution(f)
    if (!execution.allowed) return execution
  }
  if (m && (!f || f.provider !== m.provider) && m.rules.toExternal === "blocked") return no(m, "OUTBOUND_COPY_BLOCKED", `${m.name} doesn't permit copying from its accounts to accounts elsewhere.`)
  return ok(f ?? m)
}

// A whole Copy Group: the first thing wrong with each follower, if anything is.
export function validateGroup<T extends Party & { accountId: number }>(master: T, followers: T[]): { accountId: number; verdict: Verdict }[] {
  return followers.map((f) => ({ accountId: f.accountId, verdict: validateDirection(master, f) }))
}

// May this account be given this role at all (before any group exists)?
export function validateRole(party: Party, role: "leader" | "follower" | "both"): Verdict {
  const reading = connected(party.set)
  if (!reading.allowed) return reading
  if (role === "leader") return ok(party.set)
  return validateExecution(party.set)
}

// ------------------------------------------------------------------ what the pages show

export type IntegrationStatus = "supported" | "restricted" | "own_risk" | "approval_required" | "disabled"
export const INTEGRATION_LABELS: Record<IntegrationStatus, string> = { supported: "Supported", restricted: "Supported with restrictions", own_risk: "At your own risk", approval_required: "Approval required", disabled: "Disabled" }

export function integrationStatus(set: ProviderRuleSet): IntegrationStatus {
  if (set.status === "disabled") return "disabled"
  if (set.rules.cloudConnection === "approval_required") return "approval_required"
  if (set.rules.cloudConnection === "own_risk") return "own_risk"
  const r = set.rules
  return [r.execution, r.toExternal, r.fromExternal, r.ownToOwn, r.crossUser].includes("blocked") ? "restricted" : "supported"
}

export type RuleLine = { key: string; label: string; allowed: boolean }

// The provider's rules as a trader reads them: a line each, permitted or not.
export function ruleLines(set: ProviderRuleSet): RuleLine[] {
  const r = set.rules
  const n = set.name
  return [
    { key: "toExternal", label: `${n} → External`, allowed: r.toExternal === "allowed" },
    { key: "ownToOwn", label: `Own ${n} → Own ${n}`, allowed: r.ownToOwn === "allowed" },
    { key: "fromExternal", label: `External → ${n}`, allowed: r.fromExternal === "allowed" },
    { key: "crossUser", label: `Other user's ${n} → Your ${n}`, allowed: r.crossUser === "allowed" },
    { key: "cloudConnection", label: "VPS/VPN-based connection", allowed: r.cloudConnection === "allowed" },
  ]
}

// What is shown wherever a provider with rules is involved: the profile.
export type ProviderProfile = {
  provider: string
  name: string
  // "FUNDINGPIPS_V1"
  profile: string
  version: number
  effectiveDate: string
  status: IntegrationStatus
  statusLabel: string
  lines: RuleLine[]
  masterCredential: string
  notes: string[]
  sources: { label: string; url: string }[]
  ownCopier: { name: string; url: string } | null
  guide: string | null
  // connecting an account of this provider, as TradeLoop connects, before the trader has accepted anything
  connection: Verdict
  // whether an account of this provider can be connected at all
  connectable: boolean
  // what the trader must accept first, when connecting goes against the provider's own rule; null otherwise
  risk: string | null
}

export function providerProfile(set: ProviderRuleSet): ProviderProfile {
  const status = integrationStatus(set)
  return {
    provider: set.provider,
    name: set.name,
    profile: `${set.provider.toUpperCase()}_V${set.version}`,
    version: set.version,
    effectiveDate: set.effectiveDate,
    status,
    statusLabel: INTEGRATION_LABELS[status],
    lines: ruleLines(set),
    masterCredential: set.rules.masterCredential === "investor_only" ? "Investor / read-only" : "Investor or trading",
    notes: set.rules.notes,
    sources: set.sources,
    ownCopier: set.ownCopier,
    guide: set.guide,
    connection: validateConnection(set, { credential: "investor" }),
    connectable: connected(set).allowed,
    risk: set.status === "active" && set.rules.cloudConnection === "own_risk" ? riskNotice(set) : null,
  }
}
