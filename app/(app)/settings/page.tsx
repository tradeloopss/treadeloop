import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getAccounts } from "@/app/actions/accounts"
import { getMySubscription } from "@/app/actions/subscriptions"
import { isOwner, isPro } from "@/lib/subscription"
import { PageHeader } from "@/components/page-header"
import { SettingsShell } from "@/components/settings-shell"
import { db } from "@/lib/db"
import { account } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { getT } from "@/lib/i18n/server"

export default async function SettingsPage() {
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [accounts, subscription, owner, pro, credential] = await Promise.all([
    getAccounts(),
    getMySubscription(),
    session?.user ? isOwner(session.user.id) : Promise.resolve(false),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
    session?.user
      ? db.select({ id: account.id }).from(account).where(and(eq(account.userId, session.user.id), eq(account.providerId, "credential"))).limit(1)
      : Promise.resolve([]),
  ])

  return (
    <div>
      <PageHeader title={t("Settings")} description={t("Manage your accounts, subscription, and security")} />
      <div className="p-4 sm:p-6">
        <SettingsShell
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            broker: a.broker,
            startingBalance: a.startingBalance,
            currentBalance: a.currentBalance,
            currency: a.currency,
            isLiveSynced: a.isLiveSynced,
            lastSyncedAt: a.lastSyncedAt,
            lastSyncStatus: a.lastSyncStatus,
          }))}
          subscription={
            subscription
              ? { plan: subscription.plan, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd }
              : null
          }
          isOwner={owner}
          isPro={pro}
          twoFactorEnabled={!!session?.user.twoFactorEnabled}
          hasPassword={credential.length > 0}
        />
      </div>
    </div>
  )
}
