import { listTradeTemplates } from "@/app/actions/settings-lists"
import { TradeTemplatesView } from "@/components/settings/pages/trade-templates-view"

export const metadata = { title: "Trade Templates" }

export default async function TradeTemplatesSettingsPage() {
  const templates = await listTradeTemplates()
  return <TradeTemplatesView initial={templates} />
}
