import { SENDER_NAMES, type Sender } from "./layout"

// Who the transactional emails come from, and how a failed delivery is
// retried. Pure — the outbox applies it, the tests check it.

const DEFAULTS: Record<Sender, string> = { affiliate: "affiliate@tradeloop.pro", payments: "payments@tradeloop.pro", support: "support@tradeloop.pro" }
const ENV: Record<Sender, string> = { affiliate: "AFFILIATE_FROM_EMAIL", payments: "PAYMENTS_FROM_EMAIL", support: "SUPPORT_FROM_EMAIL" }
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/

// The From header for a kind of email: "TradeLoop Payments <payments@tradeloop.pro>".
// The address comes from AFFILIATE_FROM_EMAIL / PAYMENTS_FROM_EMAIL /
// SUPPORT_FROM_EMAIL; anything
// that isn't a plain address falls back to the program's own — never to the
// site-wide no-reply sender.
export function senderAddress(kind: Sender): string {
  const configured = process.env[ENV[kind]]?.trim() ?? ""
  return `${SENDER_NAMES[kind]} <${ADDRESS.test(configured) ? configured : DEFAULTS[kind]}>`
}

// The inbox every support request is delivered to (SUPPORT_EMAIL). The one
// place the address is decided: nothing else spells it out.
export function supportInbox(): string {
  const configured = process.env.SUPPORT_EMAIL?.trim() ?? ""
  return ADDRESS.test(configured) ? configured : DEFAULTS.support
}

// Minutes to wait before the 2nd, 3rd… attempt. After the last, the email is
// given up on and marked failed.
const BACKOFF_MINUTES = [1, 5, 30, 120, 360]
export const MAX_EMAIL_ATTEMPTS = BACKOFF_MINUTES.length + 1

// How long to wait after the attempt numbered `attempts` (1 = the first) failed.
export const retryDelayMs = (attempts: number) => BACKOFF_MINUTES[Math.min(BACKOFF_MINUTES.length - 1, Math.max(0, attempts - 1))] * 60_000
