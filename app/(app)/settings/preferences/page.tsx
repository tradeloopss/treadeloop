import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { and, asc, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts } from "@/lib/db/schema"
import { getUserSettings } from "@/app/actions/settings"
import { PreferencesView } from "@/components/settings/pages/preferences-view"

export const metadata = { title: "Preferences" }

export default async function PreferencesSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const [s, accounts] = await Promise.all([
    getUserSettings(),
    db
      .select({ id: tradingAccounts.id, name: tradingAccounts.name })
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.userId, session.user.id), eq(tradingAccounts.archived, false)))
      .orderBy(asc(tradingAccounts.name)),
  ])

  return <PreferencesView initial={s.preferences} accounts={accounts.map((a) => ({ id: String(a.id), name: a.name }))} />
}
