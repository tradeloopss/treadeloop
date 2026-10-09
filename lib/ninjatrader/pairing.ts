import { createHash, randomInt } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { ninjatraderPairCodes } from "@/lib/db/schema"
import { createDeviceKey } from "@/lib/ninjatrader/connections"

// Short-lived pairing codes (the "ABC-123" shown in the dashboard, Phase 6).
// They are an additional onboarding option: the logged-in dashboard mints a
// code; at the VPS the trader redeems it to fetch their keyed add-on without
// signing in to TradeLoop there. The plaintext code is never stored (only its
// SHA-256 hash), it is single-use and expires in 10 minutes, and it carries no
// account credential — redeeming it mints an ordinary, revocable device key.
// The existing keyed add-on download is untouched.

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000
// No 0/O/1/I/L: unambiguous when typed by hand. 9 chars ≈ 44 bits of entropy.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const GROUPS = 3
const GROUP_LEN = 3

export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

export function hashPairCode(code: string): string {
  return createHash("sha256").update(normalizePairCode(code)).digest("hex")
}

export function newPairCode(): { code: string; hash: string } {
  const groups: string[] = []
  for (let g = 0; g < GROUPS; g++) {
    let s = ""
    for (let i = 0; i < GROUP_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)]
    groups.push(s)
  }
  const code = groups.join("-")
  return { code, hash: hashPairCode(code) }
}

export interface PairCodeView {
  code: string
  expiresAt: string
}

// One active code per user: generating a new one drops any the user hasn't
// redeemed yet.
export async function createPairCode(userId: string, label?: string | null): Promise<PairCodeView> {
  await db.delete(ninjatraderPairCodes).where(and(eq(ninjatraderPairCodes.userId, userId), isNull(ninjatraderPairCodes.consumedAt)))
  const { code, hash } = newPairCode()
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS)
  await db.insert(ninjatraderPairCodes).values({ userId, codeHash: hash, label: label?.slice(0, 64) ?? null, expiresAt })
  return { code, expiresAt: expiresAt.toISOString() }
}

export type RedeemResult = { ok: true; userId: string; key: string } | { ok: false; reason: "invalid" | "expired" | "used" }

// Validates and consumes a code, minting a device key for its owner. Claims the
// code first (atomic, single-use) and only then mints, so a double-submit can't
// leave two keys.
export async function redeemPairCode(rawCode: string): Promise<RedeemResult> {
  const hash = hashPairCode(rawCode)
  const [row] = await db.select().from(ninjatraderPairCodes).where(eq(ninjatraderPairCodes.codeHash, hash))
  if (!row) return { ok: false, reason: "invalid" }
  if (row.consumedAt) return { ok: false, reason: "used" }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" }
  const claimed = await db
    .update(ninjatraderPairCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(ninjatraderPairCodes.id, row.id), isNull(ninjatraderPairCodes.consumedAt)))
    .returning({ id: ninjatraderPairCodes.id })
  if (claimed.length === 0) return { ok: false, reason: "used" }
  const device = await createDeviceKey(row.userId)
  await db.update(ninjatraderPairCodes).set({ deviceKeyId: device.id }).where(eq(ninjatraderPairCodes.id, row.id))
  return { ok: true, userId: row.userId, key: device.key }
}
