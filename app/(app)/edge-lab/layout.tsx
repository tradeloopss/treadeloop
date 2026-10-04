import type React from "react"
import type { Metadata } from "next"
import { requireFeature } from "@/lib/features/server"
import { unreadAlerts } from "@/lib/edge/server"
import { InsightsFrame } from "@/components/insights/frame"

export const metadata: Metadata = { title: "Edge Lab — TradeLoop" }

// Edge Lab's shell. Who may open it is set in the admin panel (lib/features);
// every page under it checks again on its own.
export default async function EdgeLabLayout({ children }: { children: React.ReactNode }) {
  const { userId, stage } = await requireFeature("edge_lab")
  const unread = await unreadAlerts(userId).catch(() => 0)
  return (
    <InsightsFrame
      feature="edge_lab"
      name="Edge Lab"
      stage={stage}
      description="Find what actually makes you money, test it, and watch whether it keeps working."
      disclaimers={["history"]}
      tabs={[
        { href: "/edge-lab", label: "Overview" },
        { href: "/edge-lab/discover", label: "Discover" },
        { href: "/edge-lab/setups", label: "Setups" },
        { href: "/edge-lab/regimes", label: "Regimes" },
        { href: "/edge-lab/hypotheses", label: "Hypotheses" },
        { href: "/edge-lab/robustness", label: "Robustness" },
        { href: "/edge-lab/monitor", label: "Monitor", badge: unread },
      ]}
    >
      {children}
    </InsightsFrame>
  )
}
