"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { checkActivation } from "@/app/actions/subscriptions"
import { Button } from "@/components/ui/button"
import { Loader2, TrendingUp } from "lucide-react"

const POLL_MS = 2_000
// Whop's confirmation normally lands within seconds; after this long, stop
// spinning and tell the user what's going on instead.
const GIVE_UP_AFTER_MS = 90_000

export function ActivatingPlan() {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const startedAt = Date.now()

    async function poll() {
      const active = await checkActivation().catch(() => false)
      if (cancelled) return
      if (active) {
        router.replace("/dashboard")
      } else if (Date.now() - startedAt >= GIVE_UP_AFTER_MS) {
        setTimedOut(true)
      } else {
        timer = setTimeout(poll, POLL_MS)
      }
    }
    timer = setTimeout(poll, POLL_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [router])

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-lg">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <TrendingUp className="size-7" />
        </div>
        {timedOut ? (
          <>
            <h1 className="mt-5 text-xl font-bold tracking-tight">Still confirming your payment</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This is taking longer than usual. Your plan will switch on as soon as Whop confirms it — try again in a
              minute, or contact{" "}
              <a href="mailto:support@tradeloop.pro" className="font-medium text-primary hover:underline">
                support@tradeloop.pro
              </a>
              .
            </p>
            <Button className="mt-6 h-11 w-full rounded-xl" onClick={() => router.refresh()}>
              Check again
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto mt-6 size-6 animate-spin text-primary" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-bold tracking-tight">Activating your plan…</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              Checkout complete. Taking you to your dashboard in a moment.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
