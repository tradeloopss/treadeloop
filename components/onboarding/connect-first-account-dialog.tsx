"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plug, ListChecks, Link2, LineChart } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"

// Shown to a freshly-subscribed trader who lands on the dashboard with no
// trading account yet: a one-window nudge to connect their first account so
// journaling can start. Auto-opens; once dismissed it stays closed for the rest
// of the session (it opens again next login while there's still no account).
const DISMISS_KEY = "tl.connectFirstAccount.dismissed"

export function ConnectFirstAccountDialog({ show }: { show: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!show) return
    let dismissed = false
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"
    } catch {
      // storage unavailable — just show it
    }
    if (!dismissed) setOpen(true)
  }, [show])

  function dismiss() {
    setOpen(false)
    try {
      sessionStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // ignore
    }
  }

  if (!show) return null

  const points: { icon: typeof Link2; text: string }[] = [
    { icon: Link2, text: t("Connect MetaTrader, Rithmic, Tradovate or TradingView — your trades sync automatically.") },
    { icon: LineChart, text: t("Your dashboard, calendar and reports fill in from real trades, not manual entry.") },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-1 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plug className="size-6" />
          </div>
          <DialogTitle className="text-center">{t("Connect your first account")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("Welcome to TradeLoop! Link a trading account to start journaling — it only takes a minute.")}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 py-1 text-start text-sm">
          {points.map((p, i) => {
            const Icon = p.icon
            return (
              <li key={i} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{p.text}</span>
              </li>
            )
          })}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button nativeButton={false} render={<Link href="/accounts" onClick={dismiss} />} className="w-full hover:bg-primary/90">
            <Plug className="size-4" /> {t("Connect an account")}
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/add-trade" onClick={dismiss} />} className="w-full">
            <ListChecks className="size-4" /> {t("Or log a trade manually")}
          </Button>
          <button type="button" onClick={dismiss} className="mx-auto pt-1 text-xs text-muted-foreground hover:text-foreground">
            {t("I'll do this later")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
