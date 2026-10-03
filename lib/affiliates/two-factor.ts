import { eq } from "drizzle-orm"
import { symmetricDecrypt } from "better-auth/crypto"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { twoFactor } from "@/lib/db/schema"
import type { CodeChannel } from "./action-code-rules"
import { totpMatches } from "./totp"

// How an account proves itself before its money moves: with its authenticator
// app when two-factor sign-in is switched on, otherwise with a code emailed to
// it. The authenticator's secret is read here, checked, and goes nowhere else.

async function appSecret(userId: string): Promise<string | null> {
  try {
    const [row] = await db.select({ secret: twoFactor.secret, verified: twoFactor.verified }).from(twoFactor).where(eq(twoFactor.userId, userId)).limit(1)
    // an authenticator that was set up but never confirmed isn't one
    if (!row || row.verified === false) return null
    return await symmetricDecrypt({ key: (await auth.$context).secretConfig, data: row.secret })
  } catch (e) {
    console.error("[affiliates] couldn't read the authenticator for a verification:", e instanceof Error ? e.message : e)
    return null
  }
}

export async function codeChannel(user: { id: string; twoFactorEnabled?: boolean | null }): Promise<CodeChannel> {
  return user.twoFactorEnabled && (await appSecret(user.id)) ? "app" : "email"
}

// Checks an authenticator code for this account. Unlike the sign-in endpoint it
// records nothing as "two-factor turned on" and creates no session.
export const appChecker = (userId: string) => async (code: string) => {
  const secret = await appSecret(userId)
  return !!secret && totpMatches(secret, code, Date.now())
}
