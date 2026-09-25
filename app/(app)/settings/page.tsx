import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { PageHeader } from "@/components/page-header"
import { SettingsShell } from "@/components/settings-shell"
import { db } from "@/lib/db"
import { account } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { getT } from "@/lib/i18n/server"

export default async function SettingsPage() {
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [credential] = await Promise.all([
    session?.user
      ? db.select({ id: account.id }).from(account).where(and(eq(account.userId, session.user.id), eq(account.providerId, "credential"))).limit(1)
      : Promise.resolve([]),
  ])

  return (
    <div>
      <PageHeader title={t("Settings")} description={t("Manage your accounts, subscription, and security")} />
      <div className="p-4 sm:p-6">
        <SettingsShell
          twoFactorEnabled={!!session?.user.twoFactorEnabled}
          hasPassword={credential.length > 0}
        />
      </div>
    </div>
  )
}
