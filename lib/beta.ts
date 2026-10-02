import { cache } from "react"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getAdmin } from "@/lib/admin/guard"
import { userHasPerk } from "@/lib/affiliates/perk-access"

// Who can use a feature that isn't released to everyone yet: the team, and
// anyone whose affiliate tier includes beta access (lib/affiliates/perks).
// Gate a feature in beta on this instead of on getAdmin(). Returns the signed-in
// user's id, or null. Cached per request, so a page and its actions share one
// lookup.
export const getBetaUser = cache(async (): Promise<{ id: string } | null> => {
  const admin = await getAdmin()
  if (admin) return { id: admin.id }
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return (await userHasPerk(session.user.id, "beta")) ? { id: session.user.id } : null
})
