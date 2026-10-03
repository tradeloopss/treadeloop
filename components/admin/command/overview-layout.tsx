import type React from "react"
import { cn } from "@/lib/utils"

// Where each Overview widget sits, at every width. Phones: key numbers, then
// what needs attention, revenue, activity, operations, health. Tablets: revenue
// across the top, attention and activity side by side. Wide desktops (1400px+): revenue |
// attention | activity in one row, the four operations cards in the next,
// system health along the bottom.
export function OverviewLayout({
  header,
  kpis,
  attention,
  revenue,
  activity,
  ops,
  health,
}: {
  header: React.ReactNode
  kpis: React.ReactNode
  attention: (className: string) => React.ReactNode
  revenue: ((className: string) => React.ReactNode) | null
  activity: (className: string) => React.ReactNode
  ops: React.ReactNode[]
  health: React.ReactNode | null
}) {
  const withRevenue = revenue != null
  return (
    <div className="mx-auto w-full max-w-[1600px]">
      {header}
      <div className="space-y-4 px-4 pt-4 pb-8 sm:px-6 md:space-y-5 md:pb-10">
        {kpis}
        <div className={cn("grid gap-4 md:gap-5 lg:grid-cols-2", withRevenue && "min-[87.5rem]:grid-cols-12")}>
          {attention(withRevenue ? "lg:row-start-2 min-[87.5rem]:col-span-3 min-[87.5rem]:col-start-7 min-[87.5rem]:row-start-1" : "")}
          {revenue?.("lg:col-span-2 lg:row-start-1 min-[87.5rem]:col-span-6 min-[87.5rem]:col-start-1")}
          {activity(withRevenue ? "lg:row-start-2 min-[87.5rem]:col-span-3 min-[87.5rem]:col-start-10 min-[87.5rem]:row-start-1" : "")}
        </div>
        {ops.length > 0 && <div className={cn("grid gap-4 sm:grid-cols-2 md:gap-5", ops.length >= 4 ? "min-[87.5rem]:grid-cols-4" : ops.length === 3 ? "xl:grid-cols-3" : "")}>{ops}</div>}
        {health}
      </div>
    </div>
  )
}
