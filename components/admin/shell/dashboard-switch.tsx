"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeftRight, Sparkles } from "lucide-react"
import { setDashboardVersion } from "@/app/actions/admin-shell"
import type { DashboardVersion } from "@/lib/admin/preferences"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

// Switching between the command center and the previous admin dashboard. The
// choice is saved with the admin's account (never only in this browser) and
// logged; the other version is always one click away, so nobody is trapped.

export function useDashboardSwitch() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const switchTo = (version: DashboardVersion, after?: () => void) =>
    start(async () => {
      try {
        await setDashboardVersion(version)
        after?.()
        router.refresh()
        if (version === "legacy") {
          toast("Switched to the old dashboard.", { action: { label: "Return to new dashboard", onClick: () => switchTo("modern") }, duration: 8000 })
        } else {
          toast("Switched to the new dashboard.")
        }
      } catch {
        toast.error("Couldn't switch dashboards. Try again.")
      }
    })
  return { switchTo, pending }
}

// `onConfirm` replaces the switch itself (Admin Settings saves it with the
// rest of the form); `onSwitched` hears about a switch made here.
export function ReturnToOldDialog({ open, onOpenChange, onConfirm, onSwitched }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm?: () => void; onSwitched?: () => void }) {
  const { switchTo, pending } = useDashboardSwitch()
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      {/* A bottom sheet on a phone, a dialog elsewhere. */}
      <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
            <ArrowLeftRight className="size-5" />
          </span>
          <DialogTitle className="text-base">Return to the old dashboard?</DialogTitle>
          <DialogDescription className="leading-relaxed">
            You&apos;re about to switch back to the previous TradeLoop admin dashboard. You can return to the new dashboard anytime from Admin Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DialogClose render={<Button variant="outline" size="lg" className="max-sm:h-11 max-sm:w-full" disabled={pending} />}>Cancel</DialogClose>
          <Button
            size="lg"
            className="max-sm:h-11 max-sm:w-full"
            disabled={pending}
            onClick={() =>
              onConfirm
                ? onConfirm()
                : switchTo("legacy", () => {
                    onSwitched?.()
                    onOpenChange(false)
                  })
            }
          >
            {pending ? "Switching…" : "Return to old dashboard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// On the previous dashboard: the way back.
export function ReturnToNewButton({ className, compact }: { className?: string; compact?: boolean }) {
  const { switchTo, pending } = useDashboardSwitch()
  return (
    <button
      type="button"
      onClick={() => switchTo("modern")}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
        compact ? "px-2.5 py-1.5 text-xs" : "w-full px-3 py-2 text-sm",
        className
      )}
    >
      <Sparkles className="size-4 shrink-0" aria-hidden />
      {pending ? "Switching…" : "Return to new dashboard"}
    </button>
  )
}
