import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getAffiliateByUser } from "./queries"

// Who is asking. The affiliate is ALWAYS resolved from the signed-in session —
// portal pages and actions never accept an affiliate id from the request, which
// is what keeps one affiliate out of another's data.

export const getSessionUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  // An admin's "log in as user" session: allowed to look, not to move money.
  return { ...session.user, impersonating: !!(session.session as { impersonatedBy?: string | null }).impersonatedBy }
})

export type PortalContext = { user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>; affiliate: NonNullable<Awaited<ReturnType<typeof getAffiliateByUser>>> }

// For portal pages. Sends each kind of visitor where they belong:
//   signed out            → sign in, then back here
//   never applied         → the application
//   applied, not approved → the application status screen
//   approved, not set up  → onboarding
export async function requireAffiliate(opts: { allowUnonboarded?: boolean } = {}): Promise<PortalContext> {
  const user = await getSessionUser()
  if (!user) redirect("/sign-in?next=/affiliate")
  const affiliate = await getAffiliateByUser(user.id)
  if (!affiliate || affiliate.status !== "approved") redirect("/affiliate/apply")
  if (!affiliate.onboardedAt && !opts.allowUnonboarded) redirect("/affiliate/onboarding")
  return { user, affiliate }
}

// For server actions: the same check, reported as an error instead of a
// redirect. Suspended, rejected and pending affiliates can't act.
export async function assertAffiliate(): Promise<PortalContext> {
  const user = await getSessionUser()
  if (!user) throw new Error("Sign in to continue.")
  const affiliate = await getAffiliateByUser(user.id)
  if (!affiliate) throw new Error("You don't have an affiliate account.")
  if (affiliate.status !== "approved") throw new Error("Your affiliate account isn't active.")
  return { user, affiliate }
}
