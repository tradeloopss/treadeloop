import { getPlaybooks, getPlaybookSharesForOwner, getSharedWithMePlaybooks } from "@/app/actions/playbooks"
import { getTrades } from "@/app/actions/trades"
import { PageHeader } from "@/components/page-header"
import { PlaybookManager, type PlaybookCard, type SharedPlaybookCard } from "@/components/playbook-manager"

export default async function PlaybooksPage() {
  const [playbooks, trades, shares, sharedWithMe] = await Promise.all([
    getPlaybooks(),
    getTrades(),
    getPlaybookSharesForOwner(),
    getSharedWithMePlaybooks(),
  ])

  const cards: PlaybookCard[] = playbooks.map((p) => {
    const linked = trades.filter((t) => t.playbookId === p.id && t.status === "closed")
    const netPnl = linked.reduce((sum, t) => sum + Number(t.pnl), 0)
    const wins = linked.filter((t) => Number(t.pnl) > 0).length
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      rules: p.rules,
      trades: linked.length,
      netPnl,
      winRate: linked.length ? (wins / linked.length) * 100 : 0,
      shareToken: p.shareToken,
      sharedWith: shares.filter((s) => s.playbookId === p.id),
    }
  })

  const sharedCards: SharedPlaybookCard[] = sharedWithMe.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    rules: p.rules,
    trades: p.trades,
    netPnl: p.netPnl,
    winRate: p.winRate,
    ownerId: p.ownerId,
    ownerName: p.ownerName,
  }))

  return (
    <div>
      <PageHeader title="Playbooks" description="Your trading strategies and how each one actually performs" />
      <div className="p-4 sm:p-6">
        <PlaybookManager playbooks={cards} sharedWithMe={sharedCards} />
      </div>
    </div>
  )
}
