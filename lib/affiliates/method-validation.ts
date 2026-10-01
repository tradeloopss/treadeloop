import { maskEmail } from "./engine"
import { INVALID_TRC20_MESSAGE, TRON_NETWORK, TRON_STANDARD, USDT_ASSET, maskAddress, normalizeTronAddress, tronAddressProblem } from "./tron"
import { PAYOUT_CURRENCIES, type PayoutMethodType } from "./types"

// Validation of payout-method details. Pure, so the form can use the same
// rules for inline feedback that the server uses to decide — and unit-tested.
// The server never accepts a method the form "already validated".

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const text = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max)
const compact = (v: unknown, max = 60) => text(v, max).replace(/[\s-]+/g, "").toUpperCase()

// Countries whose banks are addressed by IBAN.
const IBAN_COUNTRIES = new Set(
  "AD AE AL AT AZ BA BE BG BH BR CH CR CY CZ DE DK DO EE EG ES FI FO FR GB GE GI GL GR GT HR HU IE IL IQ IS IT JO KW KZ LB LC LI LT LU LV MC MD ME MK MR MT MU NL NO PK PL PS PT QA RO RS SA SC SE SI SK SM ST SV TL TN TR UA VA VG XK".split(" ")
)

export type BankScheme = "us" | "iban" | "swift"
// Which bank details a country needs: US routing + account, an IBAN, or an
// account number with a SWIFT/BIC code.
export const bankScheme = (country: string): BankScheme => (country === "US" ? "us" : IBAN_COUNTRIES.has(country) ? "iban" : "swift")

// ISO 13616 mod-97 check: catches a mistyped digit before money is sent to it.
export function ibanValid(value: string): boolean {
  const iban = compact(value, 40)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

export const bicValid = (value: string) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(value, 11))

// ABA routing number checksum (3-7-1 weights).
export function abaValid(value: string): boolean {
  const v = compact(value, 9)
  if (!/^\d{9}$/.test(v)) return false
  const d = v.split("").map(Number)
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0
}

export type ValidMethod = {
  // Sensitive: encrypted at rest, shown only to an admin about to pay.
  details: Record<string, string>
  // Display-safe facts (country, currency, network…).
  metadata: Record<string, string>
  // Masked, safe to show anywhere.
  label: string
  nickname: string | null
  // What identifies the destination — HMAC'd server-side into the fingerprint.
  identity: string
}

export type MethodCheck = { ok: true; method: ValidMethod } | { ok: false; error: string; field?: string }

const fail = (error: string, field?: string): MethodCheck => ({ ok: false, error, field })

function countryAndCurrency(raw: Record<string, unknown>): { country: string; currency: string } | MethodCheck {
  // Not truncated first: "USA" is a mistake to report, not "US".
  const country = text(raw.country, 8).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return fail("Choose a country.", "country")
  const currency = text(raw.currency, 8).toUpperCase()
  if (!(PAYOUT_CURRENCIES as readonly string[]).includes(currency)) return fail("Choose a currency.", "currency")
  return { country, currency }
}

export function validateMethod(type: PayoutMethodType | string, input: unknown): MethodCheck {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const nickname = text(raw.nickname, 40) || null

  if (type === "paypal") {
    const email = text(raw.email).toLowerCase()
    if (!EMAIL.test(email)) return fail("Enter the email address of your PayPal account.", "email")
    const accountType = raw.accountType === "business" ? "business" : raw.accountType === "personal" ? "personal" : ""
    if (!accountType) return fail("Choose whether it's a personal or business account.", "accountType")
    const cc = countryAndCurrency(raw)
    if ("ok" in cc) return cc
    return { ok: true, method: { details: { email }, metadata: { accountType, ...cc }, label: maskEmail(email), nickname, identity: `paypal:${email}` } }
  }

  if (type === "wise") {
    const email = text(raw.email).toLowerCase()
    if (!EMAIL.test(email)) return fail("Enter the email address of your Wise account.", "email")
    const holder = text(raw.holder, 80)
    if (holder.length < 2) return fail("Enter the account holder name.", "holder")
    const cc = countryAndCurrency(raw)
    if ("ok" in cc) return cc
    return { ok: true, method: { details: { email, holder }, metadata: { ...cc }, label: maskEmail(email), nickname, identity: `wise:${email}` } }
  }

  if (type === "bank") {
    const holder = text(raw.holder, 80)
    if (holder.length < 2) return fail("Enter the account holder name.", "holder")
    const cc = countryAndCurrency(raw)
    if ("ok" in cc) return cc
    const scheme = bankScheme(cc.country)
    const bankName = text(raw.bankName, 80)
    if (scheme === "us") {
      const routing = compact(raw.routing, 9)
      if (!abaValid(routing)) return fail("That routing number isn't valid. It's the 9-digit ABA number for your bank.", "routing")
      const account = compact(raw.account, 17)
      if (!/^\d{4,17}$/.test(account)) return fail("Enter your account number (4–17 digits).", "account")
      const accountType = raw.accountType === "savings" ? "savings" : "checking"
      return { ok: true, method: { details: { holder, routing, account, accountType, ...(bankName ? { bankName } : {}) }, metadata: { ...cc, scheme }, label: `${bankName || "Bank account"} ···· ${account.slice(-4)}`, nickname, identity: `bank:us:${routing}:${account}` } }
    }
    if (scheme === "iban") {
      const iban = compact(raw.iban, 34)
      if (!ibanValid(iban)) return fail("That IBAN isn't valid. Check it against your bank statement.", "iban")
      if (iban.slice(0, 2) !== cc.country) return fail(`That IBAN belongs to a different country (${iban.slice(0, 2)}) than the one selected.`, "iban")
      const swift = compact(raw.swift, 11)
      if (swift && !bicValid(swift)) return fail("That SWIFT/BIC code doesn't look right (8 or 11 characters).", "swift")
      return { ok: true, method: { details: { holder, iban, ...(swift ? { swift } : {}), ...(bankName ? { bankName } : {}) }, metadata: { ...cc, scheme }, label: `${bankName || "IBAN"} ···· ${iban.slice(-4)}`, nickname, identity: `bank:iban:${iban}` } }
    }
    const account = compact(raw.account, 34)
    if (!/^[A-Z0-9]{4,34}$/.test(account)) return fail("Enter your account number.", "account")
    const swift = compact(raw.swift, 11)
    if (!bicValid(swift)) return fail("Enter your bank's SWIFT/BIC code (8 or 11 characters).", "swift")
    if (bankName.length < 2) return fail("Enter the bank name.", "bankName")
    return { ok: true, method: { details: { holder, account, swift, bankName }, metadata: { ...cc, scheme }, label: `${bankName} ···· ${account.slice(-4)}`, nickname, identity: `bank:swift:${swift}:${account}` } }
  }

  if (type === "crypto_trc20") {
    const address = normalizeTronAddress(raw.address)
    if (!address) return fail("Enter your wallet address.", "address")
    if (tronAddressProblem(address)) return fail(INVALID_TRC20_MESSAGE, "address")
    // The network is fixed by the method — a request naming any other is refused
    // rather than quietly corrected.
    if (raw.network != null && raw.network !== TRON_NETWORK) return fail("USDT payouts are sent on the TRON (TRC-20) network only.", "network")
    if (raw.asset != null && raw.asset !== USDT_ASSET) return fail("This payout method pays USDT only.", "asset")
    if (raw.confirmNetwork !== true) return fail("Confirm that this wallet supports USDT on TRC-20.", "confirmNetwork")
    // A second look at the address, typed by hand: the last six characters.
    if (text(raw.confirmTail, 6) !== address.slice(-6)) return fail("The last six characters you typed don't match the wallet address.", "confirmTail")
    return {
      ok: true,
      method: { details: { address }, metadata: { network: TRON_NETWORK, standard: TRON_STANDARD, asset: USDT_ASSET, currency: USDT_ASSET }, label: maskAddress(address), nickname: nickname ?? "USDT wallet", identity: `crypto_trc20:${address}` },
    }
  }

  return fail("Choose a payout method.")
}
