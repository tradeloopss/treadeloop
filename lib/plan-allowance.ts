// What each plan includes: Essential — up to 3 trading accounts, and live sync
// for one of them through MetaTrader 4 or 5 only (Rithmic and TradingView sync
// stay Pro). Pro — up to 40 trading accounts with live sync on all. No server
// imports here, so the Accounts page can show the same numbers and wording; the
// checks themselves are in lib/plan-limits.ts.
export const ESSENTIAL_ACCOUNT_LIMIT = 3
export const ESSENTIAL_METATRADER_LIMIT = 1
export const PRO_ACCOUNT_LIMIT = 40

export const ACCOUNT_LIMIT_MESSAGE = `Essential includes up to ${ESSENTIAL_ACCOUNT_LIMIT} trading accounts — upgrade to Pro at /pricing for up to ${PRO_ACCOUNT_LIMIT}.`
export const PRO_ACCOUNT_LIMIT_MESSAGE = `Pro includes up to ${PRO_ACCOUNT_LIMIT} trading accounts. Remove or archive one to add another.`
export const METATRADER_LIMIT_MESSAGE =
  "Essential includes live sync for 1 MetaTrader account. Disconnect the one you have to connect a different one, or upgrade to Pro at /pricing to sync more."

// Copy Trading. A copy connection is one Copy Group: a Leader and the accounts
// that copy it. Essential includes one, of two accounts (a Leader and one
// Follower); Pro three, of five accounts each (a Leader and four Followers).
// The Leader counts, whoever's it is: a strategy a friend shares is one of the
// accounts of the group that copies it.
//
// What is already there beyond it is kept, as with accounts: only adding more,
// or switching on more than the plan includes, is refused (lib/copy/server.ts).
export const COPY_ALLOWANCE = { essential: { groups: 1, accounts: 2 }, pro: { groups: 3, accounts: 5 } } as const
export type CopyAllowance = { plan: "essential" | "pro"; groups: number; accounts: number }
export const copyAllowance = (pro: boolean): CopyAllowance => ({ plan: pro ? "pro" : "essential", ...COPY_ALLOWANCE[pro ? "pro" : "essential"] })

const followersOf = (accounts: number) => `${accounts - 1} ${accounts - 1 === 1 ? "Follower" : "Followers"}`
const groupsOf = (n: number) => `${n} Copy ${n === 1 ? "Group" : "Groups"}`
// "1 Copy Group of up to 2 accounts (a Leader and 1 Follower)"
export const copyAllowanceText = (a: CopyAllowance) => `${groupsOf(a.groups)} of up to ${a.accounts} accounts${a.groups === 1 ? "" : " each"} (a Leader and ${followersOf(a.accounts)})`
const more = (a: CopyAllowance) => (a.plan === "essential" ? ` Upgrade to Pro at /pricing for ${copyAllowanceText(copyAllowance(true))}.` : "")
const planName = (a: CopyAllowance) => (a.plan === "pro" ? "Pro" : "Essential")

// Null when it fits the plan, else why not. `groups`: how many the trader has
// (or has switched on) besides the one being made (or switched on).
// `accounts`: how many the group would have, its Leader included, and how many
// it has now: a group that already has more than the plan includes may keep
// them and change their settings, and may not take another.
export function copyAllowanceProblem(a: CopyAllowance, ask: { groups?: number; accounts?: { want: number; had?: number }; switchingOn?: boolean }): string | null {
  if (ask.groups != null && ask.groups >= a.groups)
    return ask.switchingOn
      ? `${planName(a)} includes ${groupsOf(a.groups)} copying at a time. Pause ${a.groups === 1 ? "the other one" : "one of the others"} first.${more(a)}`
      : `${planName(a)} includes ${groupsOf(a.groups)}. Delete one to make another.${more(a)}`
  if (ask.accounts && ask.accounts.want > a.accounts && (ask.switchingOn || ask.accounts.want > (ask.accounts.had ?? 0)))
    return `${planName(a)} includes up to ${a.accounts} accounts in a Copy Group: a Leader and ${followersOf(a.accounts)}.${ask.switchingOn ? " Remove a Follower from this group to switch it on." : ""}${more(a)}`
  return null
}

// An Essential user's allowance as the Accounts page shows it (null on Pro).
export interface PlanUsage {
  accounts: number
  accountLimit: number
  metatrader: number
  metatraderLimit: number
}
