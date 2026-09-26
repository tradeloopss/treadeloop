import { headers } from "next/headers"
import { Activity, Zap, LineChart, ShieldCheck, Layers } from "lucide-react"
import { auth } from "@/lib/auth"
import { isPro } from "@/lib/subscription"
import { getTradesManagerData } from "@/app/actions/trade-manager"
import { TradesManager } from "@/components/trade-manager/trades-manager"
import { FeatureGateCard } from "@/components/feature-gate-card"

export const metadata = { title: "Trades Manager" }

export default async function TradeManagerPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const pro = session?.user ? await isPro(session.user.id) : false
  // Pro-only: non-Pro users get the upgrade screen instead of the live terminal.
  if (!pro) {
    return (
      <FeatureGateCard
        header="Trades Manager"
        headerDescription="Manage every open position in one live terminal."
        badge="Pro feature"
        icon={Activity}
        title="A live trade-management terminal"
        intro="Trades Manager is part of TradeLoop Pro. It gives you:"
        points={[
          { icon: Layers, text: "Every open position — MT5, Rithmic, Tradovate and manual — in one place." },
          { icon: Zap, text: "Place, modify and close orders (full or partial) straight from TradeLoop." },
          { icon: LineChart, text: "Live P&L, KPIs and per-account exposure as the market moves." },
          { icon: ShieldCheck, text: "Rule-guarded execution so an order can't breach your prop-firm limits." },
        ]}
        cta={{ label: "See Pro plans", href: "/pricing" }}
      />
    )
  }
  const data = await getTradesManagerData()
  return <TradesManager data={data} />
}
