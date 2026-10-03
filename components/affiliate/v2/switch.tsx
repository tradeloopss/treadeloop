"use client"

import { useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeftRight, Check, LayoutDashboard, Sparkles, X } from "lucide-react"
import { chooseDashboard } from "@/app/actions/affiliate-v2"
import { v2ToClassic, type DashboardVersion } from "@/lib/affiliates/v2/config"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { affiliateHref } from "@/lib/urls"
import { inAppPath } from "./nav"
import { BetaBadge, btnClass, ghostBtnClass } from "./ui"
import { cn } from "@/lib/utils"

// Moving between the Classic dashboard and the V2 beta. The choice is saved
// with the affiliate's account; nothing else changes — the same data, the same
// money, either way.

function useSwitch() {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const go = (version: DashboardVersion, after?: () => void) =>
    start(async () => {
      const res = await chooseDashboard(version).catch(() => ({ ok: false as const, error: "We couldn't switch dashboards. Try again." }))
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      after?.()
      if (version === "classic") {
        toast("Switched to the Classic dashboard.", { description: "You can come back to the beta anytime." })
        router.push(affiliateHref(v2ToClassic(inAppPath(pathname))))
      } else {
        toast.success("Welcome to the new Affiliate Dashboard.")
        router.push(affiliateHref("/affiliate/v2"))
      }
    })
  return { go, pending }
}

export function SwitchToClassicDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { go, pending } = useSwitch()
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md">
        <DialogHeader>
          <span className="v2-icon mb-1 flex size-10 items-center justify-center rounded-xl" aria-hidden>
            <ArrowLeftRight className="size-5" />
          </span>
          <DialogTitle className="text-base font-semibold">Switch to Classic Dashboard?</DialogTitle>
          <DialogDescription>You can switch back to the new Beta dashboard anytime. Nothing about your account, earnings or payouts changes.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="max-sm:rounded-b-none">
          <button type="button" className={ghostBtnClass} onClick={() => onOpenChange(false)} disabled={pending}>
            Stay on Beta
          </button>
          <button type="button" className={btnClass} disabled={pending} onClick={() => go("classic", () => onOpenChange(false))}>
            {pending ? "Switching…" : "Switch to Classic"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// On the Classic dashboard, while the beta is open to this affiliate.
export function TryV2Banner() {
  const { go, pending } = useSwitch()
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-gradient-to-r from-[#7c3aed]/[0.08] via-[#2563eb]/[0.06] to-transparent px-4 py-2.5 sm:px-6">
      <Sparkles className="size-4 shrink-0 text-[#7c3aed] dark:text-[#a78bfa]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Try the new dashboard.</span> <span className="text-muted-foreground">A redesigned Affiliate Dashboard with a wallet, goals and more — in beta.</span>
      </p>
      <button type="button" onClick={() => go("v2")} disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#7c3aed] to-[#2563eb] px-3 text-xs font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-70">
        {pending ? "Opening…" : "Try the new dashboard"}
      </button>
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide for now" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

// Settings → Dashboard experience.
export function DashboardExperience({ current }: { current: DashboardVersion }) {
  const { go, pending } = useSwitch()
  const [confirm, setConfirm] = useState(false)
  const options: { value: DashboardVersion; title: string; body: string; icon: React.ElementType }[] = [
    { value: "classic", title: "Classic Dashboard", body: "The dashboard you know.", icon: LayoutDashboard },
    { value: "v2", title: "V2 Beta", body: "Try the redesigned TradeLoop Affiliate Dashboard.", icon: Sparkles },
  ]
  return (
    <div role="radiogroup" aria-label="Dashboard experience" className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => {
        const selected = current === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={pending}
            onClick={() => (selected ? undefined : o.value === "classic" ? setConfirm(true) : go("v2"))}
            className={cn("relative flex gap-3 rounded-xl border p-4 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", selected ? "border-primary bg-primary/[0.07]" : "hover:border-primary/40 hover:bg-muted/40")}
          >
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-muted-foreground/40")} aria-hidden>
              {selected && <span className="size-2.5 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <o.icon className="size-4 text-muted-foreground" aria-hidden /> {o.title} {o.value === "v2" && <BetaBadge />}
                {selected && <Check className="size-4 text-primary" aria-hidden />}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{o.body}</span>
            </span>
          </button>
        )
      })}
      <SwitchToClassicDialog open={confirm} onOpenChange={setConfirm} />
    </div>
  )
}
