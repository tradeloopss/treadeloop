import type React from "react"
import { Suspense } from "react"
import { FeedbackButton, InsightTabs } from "./client"
import { Disclaimer, StageBadge } from "./ui"

// The shell of an insight feature: its name, the stage it is released at, the
// feedback button, the sub-pages and the standing disclaimers.
export function InsightsFrame({ feature, name, stage, description, tabs, disclaimers, children }: { feature: string; name: string; stage: "admin" | "beta"; description: string; tabs: { href: string; label: string; badge?: number }[]; disclaimers: ("history" | "ai" | "behaviour" | "simulation")[]; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              <StageBadge stage={stage} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="shrink-0">
            <FeedbackButton feature={feature} name={name} />
          </div>
        </div>
        {/* the tabs read the address, which is only known in the browser */}
        <Suspense fallback={<div className="h-[42px]" />}>
          <InsightTabs tabs={tabs} />
        </Suspense>
      </header>
      <div className="flex-1 space-y-4 p-4 sm:space-y-5 sm:p-6">{children}</div>
      <footer className="border-t px-4 py-4 sm:px-6">
        <Disclaimer kinds={disclaimers} />
      </footer>
    </div>
  )
}
