"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

type Result = { ok: true; message?: string } | { ok: false; error: string }

// Runs a server action with the app's usual feedback: a pending flag for the
// button, a toast for the outcome, and a refresh so the page shows the result.
export function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Result>, onOk?: () => void) =>
    start(async () => {
      try {
        const result = await fn()
        if (result.ok) {
          if (result.message) toast.success(result.message)
          onOk?.()
          router.refresh()
        } else toast.error(result.error)
      } catch {
        toast.error("That didn't go through. Check your connection and try again.")
      }
    })
  return { pending, run }
}
