import { notFound } from "next/navigation"
import { getPropMaxAccountDetail } from "@/app/actions/propmax"
import { PropMaxAccountDetail } from "@/components/propmax/account-detail"

export const metadata = { title: "Account — PropFirm Max" }

export default async function PropMaxAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const id = Number(accountId)
  if (!Number.isFinite(id)) notFound()

  const { account, positions, alerts } = await getPropMaxAccountDetail(id)
  if (!account) notFound()

  return <PropMaxAccountDetail account={account} positions={positions} alerts={alerts} />
}
