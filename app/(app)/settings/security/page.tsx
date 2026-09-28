import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { account } from "@/lib/db/schema"
import { getSecurityActivity, getUserSettings } from "@/app/actions/settings"
import { SecurityView } from "@/components/settings/security/security-view"

export const metadata = { title: "Security" }

export default async function SecuritySettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const providers = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, session.user.id))
  const providerIds = Array.from(new Set(providers.map((p) => p.providerId)))
  const hasPassword = providerIds.includes("credential")

  const [settings, activity] = await Promise.all([getUserSettings(), getSecurityActivity()])

  // The @handle shown on the row: the saved username, else the local part of
  // the email (matching the reference, which shows an email-derived handle).
  const handle = settings.username ?? session.user.email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").toLowerCase()

  return (
    <SecurityView
      email={session.user.email}
      handle={handle}
      hasPassword={hasPassword}
      twoFactorEnabled={!!(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled}
      // "credential" is the email/password login; the rest are social providers.
      oauthProviders={providerIds.filter((p) => p !== "credential")}
      activity={activity}
    />
  )
}
