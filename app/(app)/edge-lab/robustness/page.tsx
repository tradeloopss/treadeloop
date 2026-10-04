import { outcomes, select } from "@/lib/edge/core"
import { dimOptions, insightPage, type SearchParams } from "@/lib/edge/page"
import { walkForward } from "@/lib/edge/robustness"
import { filterKey } from "@/lib/insights/data"
import { FilterBar } from "@/components/insights/client"
import { RobustnessLab } from "@/components/edge-lab/robustness"

export default async function RobustnessPage({ searchParams }: { searchParams: SearchParams }) {
  const { trades, loaded, filters, conditions } = await insightPage("edge_lab", searchParams)
  const slice = select(trades, conditions)
  const o = outcomes(slice)
  return (
    <>
      <FilterBar lookups={loaded.lookups} />
      <RobustnessLab
        key={`${filterKey(filters)}:${JSON.stringify(conditions)}`}
        options={dimOptions(trades)}
        initialConditions={conditions}
        initial={{ outcomes: o.values.map((v) => Math.round(v * 1000) / 1000), unit: o.unit, n: slice.length, walk: walkForward(slice) }}
      />
    </>
  )
}
