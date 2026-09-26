import { getOpenTradesOverview } from "@/app/actions/trade-manager"
import { TradeManager } from "@/components/trade-manager/trade-manager"

export const metadata = { title: "Trade Manager" }

export default async function TradeManagerPage() {
  const data = await getOpenTradesOverview()
  return <TradeManager data={data} />
}
