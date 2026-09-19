import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { isPro } from "@/lib/subscription"
import { getPayoutSummary } from "@/app/actions/payouts"
import { PageHeader } from "@/components/page-header"
import { PayoutsWorkspace } from "@/components/payouts-workspace"
import { getT } from "@/lib/i18n/server"

export default async function PayoutsPage() {
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [summary, pro] = await Promise.all([
    getPayoutSummary("monthly"),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
  ])

  return (
    <div>
      <PageHeader title={t("Payouts")} description={t("Every payout across your accounts, with a certificate you can share")} />
      <div className="p-4 sm:p-6">
        <PayoutsWorkspace initial={summary} isPro={pro} />
      </div>
    </div>
  )
}
