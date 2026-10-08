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
import { ModeBanner, ModeChip } from "@/components/copy/mode-banner"

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
          {/* one slim bar: the four pages, and whether orders are real. The pages are trading screens and keep the room. */}
          <header className="flex items-center gap-2 border-b pe-4 sm:pe-6">
            <CopyTabs />
            <div className="flex shrink-0 items-center gap-2 py-1.5">
              <span className="hidden sm:inline-flex">
                <StageBadge stage={stage} />
              </span>
              <ModeChip admin={isAdmin} />
              <span className="hidden sm:block">
                <FeedbackButton feature="copy_trading" name="Copy Trading" />
              </span>
            </div>
          </header>
          <div className="flex-1 space-y-4 p-4 sm:space-y-5 sm:p-6">
            <ModeBanner admin={isAdmin} />
            {children}
            {/* on a phone the bar above has room for the pages and the mode only */}
            <div className="flex items-center justify-between gap-2 sm:hidden">
              <StageBadge stage={stage} />
              <FeedbackButton feature="copy_trading" name="Copy Trading" />
            </div>
          </div>
        </div>
      </CopyProvider>
    </Suspense>
  )
}
