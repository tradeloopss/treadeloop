import { MIN_TRADES, cleanConditions } from "@/lib/edge/core"
import { dimOptions, insightPage, type SearchParams } from "@/lib/edge/page"
import { listHypotheses } from "@/lib/edge/server"
import { filterKey } from "@/lib/insights/data"
import { FilterBar } from "@/components/insights/client"
import { NotEnough } from "@/components/insights/ui"
import { ComparisonLab, HypothesisLab } from "@/components/edge-lab/hypotheses"

export default async function HypothesesPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId, trades, loaded, filters, conditions } = await insightPage("edge_lab", searchParams)
  const saved = await listHypotheses(userId)
  const options = dimOptions(trades)
  return (
    <>
      <FilterBar lookups={loaded.lookups} />
      {trades.length < MIN_TRADES && (
        <NotEnough have={trades.length} need={MIN_TRADES}>
          You can test an idea now, but with fewer than {MIN_TRADES} trades in the period the answer will almost always be “inconclusive”.
        </NotEnough>
      )}
      <HypothesisLab
        key={`${filterKey(filters)}:${JSON.stringify(conditions)}`}
        options={options}
        initial={conditions}
        saved={saved.map((h) => ({ id: h.id, name: h.name, statement: h.statement, conditions: cleanConditions(h.conditions), result: (h.result ?? null) as Record<string, never> | null }))}
      />
      <ComparisonLab key={`ab:${filterKey(filters)}`} options={options} />
    </>
  )
}
