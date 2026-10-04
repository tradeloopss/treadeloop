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
        // grouped the way the main menu lists them (lib/navigation.ts)
        { href: "/edge-lab", label: "Overview", group: "overview" },
        { href: "/edge-lab/discover", label: "Discover", group: "discovery" },
        { href: "/edge-lab/regimes", label: "Regimes", group: "discovery" },
        { href: "/edge-lab/setups", label: "Setups", group: "journal" },
        { href: "/edge-lab/monitor", label: "Monitor", badge: unread, group: "journal" },
        { href: "/edge-lab/hypotheses", label: "Hypotheses", group: "tests" },
        { href: "/edge-lab/robustness", label: "Robustness", group: "tests" },
      ]}
    >
      {children}
    </InsightsFrame>
  )
}
