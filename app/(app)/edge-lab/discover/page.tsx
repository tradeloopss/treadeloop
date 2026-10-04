import { MIN_TRADES } from "@/lib/edge/core"
import { decompose, search } from "@/lib/edge/discover"
import { dimOptions, insightPage, type SearchParams } from "@/lib/edge/page"
import { cached, filterKey } from "@/lib/insights/data"
import { FilterBar } from "@/components/insights/client"
import { NotEnough } from "@/components/insights/ui"
import { Decomposition, DiscoverLab } from "@/components/edge-lab/discover"
import { EdgeSheetProvider } from "@/components/edge-lab/edge-sheet"

export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId, trades, loaded, filters, timeZone } = await insightPage("edge_lab", searchParams)
  if (trades.length < MIN_TRADES)
    return (
      <>
        <FilterBar lookups={loaded.lookups} />
        <NotEnough have={trades.length} need={MIN_TRADES}>
          The discovery engine needs {MIN_TRADES} closed trades in the period before a combination can mean anything.
        </NotEnough>
      </>
    )
  // the default search is the expensive part: kept until the trades change
  const initial = await cached(userId, `edge:discover:${filterKey(filters)}:${timeZone}`, loaded.fingerprint, () => {
    const found = search(trades, { limit: 20 })
    return { ...found, tree: decompose(trades, ["symbol", "session", "side"]) }
  })
  const options = dimOptions(trades)
  return (
    <EdgeSheetProvider>
      <FilterBar lookups={loaded.lookups} />
      <DiscoverLab key={filterKey(filters)} options={options} initial={initial} n={trades.length} />
      <Decomposition key={`tree:${filterKey(filters)}`} initial={initial.tree} total={trades.reduce((s, t) => s + t.pnl, 0)} n={trades.length} options={options} />
    </EdgeSheetProvider>
  )
}
