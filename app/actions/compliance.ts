"use server"

import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { providerProfile, type ProviderProfile } from "@/lib/compliance/engine"
import { ruleSetFor } from "@/lib/compliance/server"
import { previewCompliance } from "@/lib/copy/server"
import type { ComplianceProblem } from "@/lib/copy/view"

// What a provider's rules say, for the pages (lib/compliance). These only
// answer: every action that changes something asks the engine again itself,
// whatever a page was told here. Publishing rules is an administrator's
// (app/actions/admin-providers.ts).

async function userId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

// The rules profile a MetaTrader server falls under, as the server name is
// typed on a connect form; null for a broker with no rules of its own.
export async function checkProvider(server: string): Promise<ProviderProfile | null> {
  await userId()
  const set = await ruleSetFor(String(server ?? "").slice(0, 120))
  return set ? providerProfile(set) : null
}

// What the providers' rules have against a Master and these Followers, before
// the group is saved: the review step of the Copy Group wizard.
export async function checkCopyGroup(leaderAccountId: number, followerAccountIds: number[]): Promise<{ ok: true; problems: ComplianceProblem[] } | { ok: false; error: string }> {
  try {
    const problems = await previewCompliance(await userId(), Number(leaderAccountId), (Array.isArray(followerAccountIds) ? followerAccountIds : []).slice(0, 60).map(Number))
    return { ok: true, problems }
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    return { ok: false, error: !message || message.startsWith("Failed query") ? "Something went wrong. Try again." : message }
  }
}
