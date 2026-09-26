import { notFound, redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { getPropMaxAccountDetail } from "@/app/actions/propmax"
import { PropMaxAccountDetail } from "@/components/propmax/account-detail"

export const metadata = { title: "Account — Propfirm Tracker" }

export default async function PropMaxAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  // Pro-only: non-Pro users are bounced to the tracker's coming-soon screen.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!(session?.user && (await isPro(session.user.id)))) redirect("/propfirm-max")

  const { accountId } = await params
  const { tab } = await searchParams
  const id = Number(accountId)
  if (!Number.isFinite(id)) notFound()

  const { account, positions, alerts, daily, payouts } = await getPropMaxAccountDetail(id)
  if (!account) notFound()

  return <PropMaxAccountDetail account={account} positions={positions} alerts={alerts} daily={daily} payouts={payouts} defaultTab={tab} />
}
