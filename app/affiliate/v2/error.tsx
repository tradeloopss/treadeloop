"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCw } from "lucide-react"

// A page that fails to load says so, and offers to try again — the shell
// (navigation, header) stays usable around it.
export default function AffiliateV2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[affiliate v2]", error)
  }, [error])
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center p-6 pt-16 text-center">
      <span className="v2-icon flex size-14 items-center justify-center rounded-2xl" aria-hidden>
        <AlertTriangle className="size-7" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Something went wrong.</h1>
      <p className="mt-1 text-sm text-muted-foreground">We couldn&apos;t load your affiliate data. Your account and earnings are safe.</p>
      <button type="button" onClick={reset} className="v2-btn mt-5 inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold">
        <RotateCw className="size-4" aria-hidden /> Try Again
      </button>
    </div>
  )
}
