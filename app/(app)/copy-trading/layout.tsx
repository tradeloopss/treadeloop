import type React from "react"
import { Suspense } from "react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { requireFeature } from "@/lib/features/server"
import { loadCopyState } from "@/lib/copy/server"
import { resolveTimeZone } from "@/lib/timezone"
import { FeedbackButton } from "@/components/insights/client"
import { StageBadge } from "@/components/insights/ui"
import { CopyProvider, CopyTabs } from "@/components/copy/store"
import { ModeBanner } from "@/components/copy/mode-banner"

export const metadata: Metadata = { title: "Copy Trading — TradeLoop" }

// Copy Trading's shell. Who may open it is set in the admin panel
// (lib/features); every page under it, and every action, checks again.
export default async function CopyTradingLayout({ children }: { children: React.ReactNode }) {
  const { userId, stage, isAdmin } = await requireFeature("copy_trading")
  const state = await loadCopyState(userId, resolveTimeZone(await headers()))
  return (
    // the pages read the selected group from the address, which is only known in the browser
    <Suspense fallback={null}>
      <CopyProvider initial={state}>
        <div className="flex min-h-full flex-col">
          <header className="border-b">
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">Copy Trading</h1>
                  <StageBadge stage={stage} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">One Leader, any number of Followers, each copying within its own risk limits.</p>
              </div>
              <div className="shrink-0">
                <FeedbackButton feature="copy_trading" name="Copy Trading" />
              </div>
            </div>
            <CopyTabs />
          </header>
          <div className="flex-1 space-y-4 p-4 sm:space-y-5 sm:p-6">
            <ModeBanner admin={isAdmin} />
            {children}
          </div>
        </div>
      </CopyProvider>
    </Suspense>
  )
}
