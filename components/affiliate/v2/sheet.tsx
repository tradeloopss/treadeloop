"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { copyText } from "./referral-link"

// The Wallet and Payout pages' windows: a sheet that rises from the bottom on a
// phone (thumb-reachable buttons, a grab handle), a compact centred window from
// sm up. `locked` keeps it open while something is being sent.
export function Sheet({ open, onOpenChange, title, description, children, footer, locked = false, className }: { open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; locked?: boolean; className?: string }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (locked ? undefined : onOpenChange(next))}>
      <DialogContent
        className={cn(
          "top-auto bottom-0 left-0 flex max-h-[92svh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-3xl rounded-b-none p-0 max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom-6 max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom-6 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[min(46rem,92svh)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl motion-reduce:animate-none",
          className
        )}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden" />
        <header className="shrink-0 px-5 pt-4 pb-3 pe-12 sm:pt-5">
          <DialogTitle className="text-lg leading-tight font-semibold tracking-tight">{title}</DialogTitle>
          {description && <DialogDescription className="mt-1 text-sm text-muted-foreground">{description}</DialogDescription>}
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <footer className="flex shrink-0 gap-2.5 border-t bg-muted/30 px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">{footer}</footer>}
      </DialogContent>
    </Dialog>
  )
}

// Copies, then says so on the button itself for a moment (and in a toast).
export function CopyButton({ value, label, done = "Copied!", className }: { value: string; label: string; done?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={label}
      onClick={async () => {
        if (!(await copyText(value, done))) return
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      }}
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", copied && "text-gain hover:text-gain", className)}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  )
}

export type Detail = { label: string; value: React.ReactNode; copy?: { value: string; label: string; done?: string }; strong?: boolean }

// Label / value rows inside a sheet. `copy` adds the copy button beside a value.
export function DetailRows({ rows, className }: { rows: (Detail | null | false | undefined | "" | 0)[]; className?: string }) {
  const shown = rows.filter((r): r is Detail => !!r)
  return (
    <dl className={cn("divide-y rounded-2xl border bg-background/40 text-sm", className)}>
      {shown.map((r) => (
        <div key={r.label} className={cn("flex min-h-11 items-center justify-between gap-3 px-3.5 py-2", r.copy && "pe-1.5")}>
          <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
          <dd className={cn("flex min-w-0 items-center gap-1 text-end font-medium tabular-nums", r.strong && "text-base font-semibold")}>
            <span className="min-w-0 truncate">{r.value}</span>
            {r.copy && <CopyButton {...r.copy} />}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// The same height as the app's buttons, in the sheet's two weights.
export const sheetBtn = "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
export const sheetBtnQuiet = cn(sheetBtn, "border bg-card/60 hover:border-primary/40 hover:bg-primary/[0.06]")
export const sheetBtnDanger = cn(sheetBtn, "bg-loss text-white hover:brightness-110")
