import { cryptoSpec } from "./crypto"
import { methodLabel, money } from "./types"

// What a payout request form works out in the browser, shared by the Request
// Payout window (Classic) and the Payout page's step-by-step form (V2), so both
// say the same thing about the same amount. None of it is trusted: the server
// applies the same rules again when the request is made
// (payout-engine.manualPayoutProblem, payouts.createPayout).

// A saved payout method, as far as the form needs to know it.
export type MethodLike = { type: string; label: string; nickname: string | null; status: string; holdUntil: string | null }

// One key per attempt: submitting twice with it can't pay twice.
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "")
export const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
// (One argument each, on purpose: these are handed straight to .filter() and .find().)
export const inHold = (m: Pick<MethodLike, "holdUntil">) => !!m.holdUntil && new Date(m.holdUntil).getTime() > Date.now()
// Can be paid to right now: active, and past its security hold.
export const usable = (m: Pick<MethodLike, "status" | "holdUntil">) => m.status === "active" && !inHold(m)
// Down to whole cents, never up: 25% of $10.01 is $2.50, not $2.51.
export const cents = (v: number) => Math.floor(v * 100 + 1e-6) / 100

// What a method is called, and the line under it: "USDT" / "TRON (TRC-20) · TXYZ…8291".
export function describeMethod(m: Pick<MethodLike, "type" | "label" | "nickname">) {
  const coin = cryptoSpec(m.type)
  return { name: m.nickname || (coin ? coin.assetName : methodLabel(m.type)), detail: coin ? `${coin.networkLabel} · ${m.label}` : `${m.nickname ? `${methodLabel(m.type)} · ` : ""}${m.label}` }
}

// Why a saved method can't be chosen right now, or null when it can.
export function methodUnavailable(m: Pick<MethodLike, "status" | "holdUntil">): string | null {
  if (usable(m)) return null
  if (m.status === "active") return `Security hold until ${fmtWhen(m.holdUntil!)}`
  if (m.status === "disabled") return "Disabled"
  if (m.status === "pending_verification") return "Being verified"
  if (m.status === "verification_required") return "Needs verification"
  return "Not available"
}

// The amount as typed → a number, or why it can't be requested.
export function readAmount(text: string, limits: { min: number; max: number | null; available: number; minWhy?: string }): { value: number | null; problem: string | null } {
  const raw = text.trim()
  if (!raw) return { value: null, problem: "Enter an amount." }
  if (!/^\d*\.?\d*$/.test(raw) || raw === ".") return { value: null, problem: "Enter a valid amount." }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { value: null, problem: "Enter a valid amount." }
  if ((raw.split(".")[1] ?? "").length > 2) return { value: null, problem: "Use at most two decimal places." }
  if (value <= 0) return { value: null, problem: "The amount must be greater than $0." }
  if (value < limits.min) return { value, problem: limits.minWhy ?? `The minimum payout is ${money(limits.min)}.` }
  if (value > limits.available) return { value, problem: "That's more than your available balance." }
  if (limits.max != null && value > limits.max) return { value, problem: `The most you can withdraw in one payout is ${money(limits.max)}.` }
  return { value, problem: null }
}

// "$1,245.32" pasted from somewhere is 1245.32; anything else odd is kept so the error can say so.
export const cleanAmount = (text: string) => text.replace(/[$,\s]/g, "").slice(0, 14)

// The quick picks under the amount: a share of the most that can be requested.
export function quickAmounts(most: number): [string, number][] {
  return [
    ["25%", cents(most * 0.25)],
    ["50%", cents(most * 0.5)],
    ["75%", cents(most * 0.75)],
    ["Max", most],
  ]
}
