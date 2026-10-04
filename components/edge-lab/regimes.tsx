"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { analyseMarketData } from "@/app/actions/edge-lab"
import type { MarketRefresh } from "@/lib/edge/market-server"
import { useAction } from "@/components/insights/client"
import { linkBtnPrimary } from "@/components/insights/ui"

// Fetches price history for the trader's instruments, a batch at a time. Asked
// for with a button — never on a page load — because the feed is slow.
export function AnalyseButton({ measured, attempted, hasRegimes }: { measured: number; attempted: number; hasRegimes: boolean }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [last, setLast] = useState<MarketRefresh | null>(null)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={linkBtnPrimary}
          onClick={() =>
            run(analyseMarketData, (res) => {
              setLast(res.refresh)
              router.refresh()
            })
          }
        >
          <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} />
          {pending ? "Analysing… this can take a minute" : hasRegimes || attempted ? "Analyse again" : "Analyse price history"}
        </button>
        <p className="text-xs text-muted-foreground">{attempted ? `${measured.toLocaleString("en-US")} trades measured so far (${attempted.toLocaleString("en-US")} looked at).` : "Nothing analysed yet."}</p>
      </div>
      {last && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Read {last.symbols} {last.symbols === 1 ? "market" : "markets"} ({last.regimeDays.toLocaleString("en-US")} days) and measured {last.excursions.toLocaleString("en-US")} trades.
          {last.remaining > 0 && ` ${last.remaining.toLocaleString("en-US")} trades are left — press again to continue.`}
          {last.unsupported.length > 0 && ` Not carried by the price feed: ${last.unsupported.join(", ")}.`}
          {last.failed.length > 0 && ` The feed didn't answer for: ${last.failed.join(", ")}. Try again later.`}
        </p>
      )}
    </div>
  )
}
