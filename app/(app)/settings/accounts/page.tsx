import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { and, count, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tradingAccounts } from "@/lib/db/schema"
import { AccountsSettingsView } from "@/components/settings/pages/accounts-view"

export const metadata = { title: "Accounts" }

export default async function AccountsSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/sign-in")

  const [active, all] = await Promise.all([
    db.select({ n: count() }).from(tradingAccounts).where(and(eq(tradingAccounts.userId, session.user.id), eq(tradingAccounts.archived, false))),
    db.select({ n: count() }).from(tradingAccounts).where(eq(tradingAccounts.userId, session.user.id)),
  ])
  const activeCount = active[0]?.n ?? 0
  const archivedCount = (all[0]?.n ?? 0) - activeCount

  return <AccountsSettingsView activeCount={activeCount} archivedCount={archivedCount} />
}
