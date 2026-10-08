// Whether the password an account takes orders with has been put to its
// broker, and what the broker said.
//
// A trading password used to be taken on trust, and its trader found out at
// the first trade that was not copied. Now it is checked when it is saved: the
// sync server logs in with it once (worker/mt5: /check) and writes the answer
// to metatrader_connections.tradingCheck. A real order's own outcome writes it
// too, so the answer follows the broker and not our guess.
//
// Pure: the pages, the copy engine and the worker read the same meanings.

// pending: saved, not asked yet. ok: the broker let it log in and trade.
// read_only: it logs in, and the broker won't let it trade (the investor
// password, or an account trading is switched off on). rejected: the broker
// would not log it in. null: nothing saved, or never checked.
export type TradingCheck = "pending" | "ok" | "read_only" | "rejected"

export function tradingCheckOf(raw: string | null | undefined): TradingCheck | null {
  // "checking" is the worker's own mark for one it has picked up: still not answered
  if (raw === "checking") return "pending"
  return raw === "pending" || raw === "ok" || raw === "read_only" || raw === "rejected" ? raw : null
}

// Orders go to an account unless its broker has said the saved password can't
// place them. One not checked yet is given the benefit of the doubt: the first
// order is then the check, as it always was.
export const tradingUsable = (check: TradingCheck | null): boolean => check !== "rejected" && check !== "read_only"

export const TRADING_CHECK_NOTES: Record<"read_only" | "rejected", string> = {
  rejected: "The broker rejected the password saved for orders on this account. Enter the master password again: Manage, then Allow orders.",
  read_only: "The password saved for orders on this account logs in but can't trade: it is the investor (read-only) password, or the broker has trading switched off for the account. Enter the master password: Manage, then Allow orders.",
}

// Reconnecting an account with a new login password. A trader who said "the
// password I connected with is the one to trade with" (the two are stored
// alike) said it of the connection, not of one spelling of it: the trading
// password follows the new login password, and is checked again. One entered
// by itself is left as it is.
export function followLogin(existing: { passwordEnc: string; tradingPasswordEnc: string | null }, passwordEnc: string): { tradingPasswordEnc: string; tradingCheck: "pending"; tradingCheckAt: null } | null {
  if (existing.tradingPasswordEnc == null || existing.tradingPasswordEnc !== existing.passwordEnc) return null
  return { tradingPasswordEnc: passwordEnc, tradingCheck: "pending", tradingCheckAt: null }
}
