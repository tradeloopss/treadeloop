import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { isPro } from "@/lib/subscription"
import { getPropFirmAccounts, getPropFirmTransactions } from "@/app/actions/propfirm"
import { getTradesForAccounts } from "@/app/actions/trades"
import { getRecentSyncEvents } from "@/app/actions/sync-events"
import { PropFirmWorkspace } from "@/components/propfirm-workspace"
import { AutoSyncBanner } from "@/components/auto-sync-banner"

export default async function PropFirmPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const [accounts, transactions, pro, syncEvents] = await Promise.all([
    getPropFirmAccounts(),
    getPropFirmTransactions(),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
    getRecentSyncEvents(),
  ])

  const fundedAccountIds = accounts.filter((a) => a.rules?.phase === "funded").map((a) => a.id)
  const evaluationAccountIds = accounts.filter((a) => a.rules != null && a.rules.phase !== "funded").map((a) => a.id)
  const [fundedTrades, evaluationTrades] = await Promise.all([
    getTradesForAccounts(fundedAccountIds),
    getTradesForAccounts(evaluationAccountIds),
  ])

  return (
    <>
      <AutoSyncBanner events={syncEvents} />
      <PropFirmWorkspace
        accounts={accounts}
        transactions={transactions}
        fundedTrades={fundedTrades}
        evaluationTrades={evaluationTrades}
        isPro={pro}
      />
    </>
  )
}
