import type React from "react"
import type { Metadata } from "next"
import { requireFeature } from "@/lib/features/server"
import { InsightsFrame } from "@/components/insights/frame"

export const metadata: Metadata = { title: "Psychology — TradeLoop" }

// Psychology's shell. Who may open it is set in the admin panel (lib/features);
// every page under it checks again on its own.
export default async function PsychologyLayout({ children }: { children: React.ReactNode }) {
  const { stage } = await requireFeature("psychology")
  return (
    <InsightsFrame
      feature="psychology"
      name="Psychology"
      stage={stage}
      description="How your behaviour and state of mind change your results — measured from your own trades."
      disclaimers={["behaviour", "ai", "history"]}
      tabs={[
        { href: "/psychology", label: "Overview" },
        { href: "/psychology/patterns", label: "Patterns" },
        { href: "/psychology/triggers", label: "Triggers" },
        { href: "/psychology/review", label: "Review" },
      ]}
    >
      {children}
    </InsightsFrame>
  )
}
