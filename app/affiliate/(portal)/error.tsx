"use client"

import { useEffect } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { affiliateHref } from "@/lib/urls"

// A portal page failed to load. The sidebar (in the layout) stays usable, and
// the page can be retried without leaving it.
export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[affiliate portal]", error)
  }, [error])
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center px-6 text-center" role="alert">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--loss)]/12 text-[var(--loss)]">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h1 className="text-base font-semibold">This page couldn&apos;t be loaded</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Something went wrong on our side. Your data is safe — try again, and if it keeps happening let us know.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-4 flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href={affiliateHref("/affiliate/support")} className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium hover:bg-muted">
          Contact support
        </Link>
      </div>
    </div>
  )
}
