import { getTradesManagerData } from "@/app/actions/trade-manager"
import { TradesManager } from "@/components/trade-manager/trades-manager"

export const metadata = { title: "Trades Manager" }

export default async function TradeManagerPage() {
  const data = await getTradesManagerData()
  return <TradesManager data={data} />
}
