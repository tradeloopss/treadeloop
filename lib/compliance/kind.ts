import { PROP_FIRM_NAMES } from "@/lib/propfirm-presets"

// Which accounts may take part when a strategy is shared between people: a
// trader's own account with a broker, and nothing else.
//
// A prop firm's account (evaluation, challenge, funded) trades the firm's
// capital under the firm's rules, and those rules forbid copying between
// different people's accounts and having someone else's trades run on one.
// So a prop-firm account is never a shared Leader, and never follows one. The
// same account stays free to be copied between its owner's own accounts, as
// its own provider's rules allow (engine.ts).
//
// Pure. What is known about an account is handed in; an account is taken for a
// broker's only when nothing says otherwise AND it is a MetaTrader connection:
// the futures logins TradeLoop connects (Rithmic, Tradovate) are prop firms'
// almost without exception, and can't be told apart from here.

export type AccountFacts = {
  // how the account is connected; null for a manual or imported one
  platform: "mt5" | "mt4" | "rithmic" | "other" | null
  // the MetaTrader server, and the broker or firm the account is labelled with
  server?: string | null
  broker?: string | null
  // a provider with rules of its own claims it (lib/compliance/engine.ts detectProvider)
  provider?: string | null
  // the trader tracks it as a prop-firm account in the Propfirm Tracker
  propTracked?: boolean
}

export type AccountKind = { kind: "broker" } | { kind: "prop" | "other"; reason: string }

const letters = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")

// Names a prop firm's server or label carries that its listed name doesn't
// (ACG Markets is Alpha Capital's broker), and firms TradeLoop has no preset for.
const ALSO = ["FTMO", "ACG Markets", "ACGMarkets", "Alpha Capital Group", "The Funded Trader", "FunderPro", "FXIFY", "My Forex Funds", "City Traders Imperium", "Funding Traders", "Goat Funded Trader", "Instant Funding", "Funded Trading Plus", "Lark Funding", "Ment Funding", "Nova Funding", "OneFunded", "PipFarm", "QT Funded", "SabioTrade", "Seacrest Funded", "ThinkCapital", "E8 Funding"]
// (a name too short to be told from part of a broker's is matched from the start of the label only)
const FIRMS = [...new Set([...PROP_FIRM_NAMES, ...ALSO])].map((name) => ({ name, key: letters(name.replace(/\(.*\)/, "")) })).filter((f) => f.key.length >= 3)

// The prop firm an account's server or label names, if it names one.
export function propFirmOf(facts: Pick<AccountFacts, "server" | "broker">): string | null {
  for (const text of [letters(facts.server), letters(facts.broker)]) {
    if (!text) continue
    const hit = FIRMS.find((f) => (f.key.length >= 6 ? text.includes(f.key) : text.startsWith(f.key)))
    if (hit) return hit.name
  }
  return null
}

export function accountKind(facts: AccountFacts): AccountKind {
  if (facts.provider) return { kind: "prop", reason: `${facts.provider} is a prop firm: its accounts can't be part of a strategy shared between people.` }
  const firm = propFirmOf(facts)
  if (firm) return { kind: "prop", reason: `This looks like a ${firm} account. A prop-firm account can't be part of a strategy shared between people.` }
  if (facts.propTracked) return { kind: "prop", reason: "This account is tracked as a prop-firm account. A prop-firm account can't be part of a strategy shared between people." }
  if (facts.platform !== "mt5" && facts.platform !== "mt4") return { kind: "other", reason: "Only a MetaTrader account with a broker can be part of a strategy shared between people." }
  return { kind: "broker" }
}

// Sharing a strategy between two people: the Leader's account and the
// Follower's are both asked, and each must be a broker's.
export function validateSharing(leader: AccountKind, follower: AccountKind): { allowed: true } | { allowed: false; reasonCode: "SHARED_LEADER_NOT_BROKER" | "SHARED_FOLLOWER_NOT_BROKER"; message: string } {
  if (leader.kind !== "broker") return { allowed: false, reasonCode: "SHARED_LEADER_NOT_BROKER", message: `The strategy's account is not a broker account. ${leader.reason}` }
  if (follower.kind !== "broker") return { allowed: false, reasonCode: "SHARED_FOLLOWER_NOT_BROKER", message: `Only your own broker accounts can copy a friend's strategy. ${follower.reason}` }
  return { allowed: true }
}
