import { getPlaybooks, getPlaybookSharesForOwner, getSharedWithMePlaybooks } from "@/app/actions/playbooks"
import { getTrades } from "@/app/actions/trades"
import { PageHeader } from "@/components/page-header"
import { PlaybookManager, type PlaybookCard, type SharedPlaybookCard } from "@/components/playbook-manager"
import { getT } from "@/lib/i18n/server"
import { featureAccess } from "@/lib/features/server"
import { edgeForPlaybooks } from "@/lib/edge/server"
import { conditionsParam } from "@/lib/edge/core"

export default async function PlaybooksPage() {
  const t = await getT()
  const [playbooks, trades, shares, sharedWithMe] = await Promise.all([
    getPlaybooks(),
    getTrades(),
    getPlaybookSharesForOwner(),
    getSharedWithMePlaybooks(),
  ])

  // Edge Lab, for traders who have it: a playbook made from an edge opens that
  // edge; any other opens the trades logged under it.
  const access = await featureAccess()
  const edges = access.can.edge_lab && access.userId ? await edgeForPlaybooks(access.userId).catch(() => new Map()) : null

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
      edgeHref: edges ? `/edge-lab?c=${encodeURIComponent(conditionsParam(edges.get(p.id)?.conditions ?? { strategy: p.name }))}` : null,
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
      <PageHeader title={t("Playbooks")} description={t("Your trading strategies and how each one actually performs")} />
      <div className="p-4 sm:p-6">
        <PlaybookManager playbooks={cards} sharedWithMe={sharedCards} />
      </div>
    </div>
  )
}
