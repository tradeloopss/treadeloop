import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getAccounts } from "@/app/actions/accounts"
import { getMySubscription } from "@/app/actions/subscriptions"
import { isOwner, isPro } from "@/lib/subscription"
import { PageHeader } from "@/components/page-header"
import { SettingsShell } from "@/components/settings-shell"

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const [accounts, subscription, owner, pro] = await Promise.all([
    getAccounts(),
    getMySubscription(),
    session?.user ? isOwner(session.user.id) : Promise.resolve(false),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
  ])

  return (
    <div>
      <PageHeader title="Settings" description="Manage your accounts, subscription, and security" />
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
        />
      </div>
    </div>
  )
}
