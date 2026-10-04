"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { toast } from "sonner"
import { MessageSquarePlus, SlidersHorizontal, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { sendFeatureFeedback } from "@/app/actions/features"
import { fieldClass, linkBtn, linkBtnPrimary } from "./ui"

// The filters every Edge Lab and Psychology page reads from its address.
const FILTER_KEYS = ["range", "from", "to", "account", "source", "symbol", "strategy", "setup"] as const

// The current filters as a query string ("" or "?range=90d&…"), for links and
// for the server actions that re-read them.
export function useFilterQuery(): string {
  const sp = useSearchParams()
  const p = new URLSearchParams()
  for (const k of FILTER_KEYS) {
    const v = sp.get(k)
    if (v) p.set(k, v)
  }
  const s = p.toString()
  return s ? `?${s}` : ""
}

// Runs a server action that answers { ok, error? } and reports a failure as a toast.
export function useAction() {
  const [pending, startTransition] = useTransition()
  const run = <T extends { ok: boolean; error?: string }>(action: () => Promise<T>, done?: (result: Extract<T, { ok: true }>) => void) =>
    startTransition(async () => {
      try {
        const result = await action()
        if (result.ok) done?.(result as Extract<T, { ok: true }>)
        else toast.error(result.error ?? "Something went wrong. Try again.")
      } catch {
        toast.error("Something went wrong. Try again.")
      }
    })
  return { pending, run }
}

// A panel for one thing in detail: a sheet from the bottom on a phone, a
// drawer from the side on a wider screen.
export function Sheet({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90svh] flex-col rounded-t-2xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[32rem] md:max-w-[92vw] md:rounded-none">
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold tracking-tight">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close aria-label="Close" className="-me-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex flex-wrap gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// The sub-pages of a feature. The filters travel with the link.
export function InsightTabs({ tabs }: { tabs: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname()
  const query = useFilterQuery()
  const root = tabs[0]?.href
  return (
    <nav aria-label="Sections" className="-mb-px flex gap-1 overflow-x-auto px-4 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab.href === root ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${query}`}
            aria-current={active ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {tab.label}
            {!!tab.badge && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">{tab.badge}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

const RANGES: [string, string][] = [
  ["7d", "7D"],
  ["30d", "30D"],
  ["90d", "90D"],
  ["6m", "6M"],
  ["1y", "1Y"],
  ["all", "All"],
]

export type FilterLookups = { accounts: { id: number; name: string }[]; playbooks: { id: number; name: string }[]; setups: string[]; symbols: string[] }

// Date range, account, market, strategy and setup. Changing one reloads the
// page with it in the address, so a view can be linked to and bookmarked.
export function FilterBar({ lookups, backtests = true }: { lookups: FilterLookups; backtests?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [more, setMore] = useState(false)
  const [from, setFrom] = useState(sp.get("from") ?? "")
  const [to, setTo] = useState(sp.get("to") ?? "")
  const range = sp.get("range") ?? "all"

  const go = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    const s = p.toString()
    startTransition(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }))
  }
  const select = (key: string, label: string, options: [string, string][]) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select className={fieldClass} value={sp.get(key) ?? ""} onChange={(e) => go({ [key]: e.target.value || null })}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
  const active = ["account", "symbol", "strategy", "setup", "source"].filter((k) => sp.get(k)).length

  const selects = (
    <>
      {lookups.accounts.length > 1 && select("account", "Account", [["", "All accounts"], ...lookups.accounts.map((a) => [String(a.id), a.name] as [string, string])])}
      {select("symbol", "Market", [["", "All markets"], ...lookups.symbols.map((s) => [s, s] as [string, string])])}
      {lookups.playbooks.length > 0 && select("strategy", "Strategy", [["", "All strategies"], ...lookups.playbooks.map((p) => [p.name, p.name] as [string, string])])}
      {lookups.setups.length > 0 && select("setup", "Setup", [["", "All setups"], ...lookups.setups.map((s) => [s, s] as [string, string])])}
      {backtests &&
        select("source", "Trades", [
          ["", "Live trades"],
          ["backtest", "Backtests only"],
          ["all", "Live and backtests"],
        ])}
    </>
  )

  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Date range" className="flex max-w-full overflow-x-auto rounded-lg border bg-background p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {RANGES.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={range === key} onClick={() => go({ range: key === "all" ? null : key, from: null, to: null })} className={cn("h-7 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors", range === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
          <button type="button" aria-pressed={range === "custom"} onClick={() => setMore(true)} className={cn("h-7 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors", range === "custom" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            Custom
          </button>
        </div>
        <button type="button" onClick={() => setMore(true)} className={cn(linkBtn, "md:hidden")}>
          <SlidersHorizontal className="size-3.5" />
          Filters{active ? ` (${active})` : ""}
        </button>
        {active > 0 && (
          <button type="button" onClick={() => go({ account: null, symbol: null, strategy: null, setup: null, source: null })} className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Clear filters
          </button>
        )}
      </div>
      <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-5">{selects}</div>

      <Sheet open={more} onClose={() => setMore(false)} title="Filters" description="What the figures on this page are worked out from.">
        <div className="grid gap-3">{selects}</div>
        <fieldset className="grid grid-cols-2 gap-3 border-t pt-4">
          <legend className="sr-only">Custom date range</legend>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <input type="date" className={fieldClass} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            To
            <input type="date" className={fieldClass} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={!from || !to || from > to}
            onClick={() => {
              go({ range: "custom", from, to })
              setMore(false)
            }}
            className={cn(linkBtnPrimary, "col-span-2")}
          >
            Apply these dates
          </button>
        </fieldset>
      </Sheet>
    </div>
  )
}

const RATINGS: [string, string][] = [
  ["love", "Love it"],
  ["good", "Good"],
  ["improve", "Needs improvement"],
  ["difficult", "Difficult to use"],
]

// "Help us improve": a rating and a few words, sent to the team.
export function FeedbackButton({ feature, name }: { feature: string; name: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const { pending, run } = useAction()
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={linkBtn}>
        <MessageSquarePlus className="size-3.5" />
        <span className="hidden sm:inline">Help us improve</span>
        <span className="sm:hidden">Feedback</span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`How is ${name} working for you?`}
        description="It goes straight to the team building it."
        footer={
          <button
            type="button"
            disabled={pending || (!rating && !message.trim())}
            className={linkBtnPrimary}
            onClick={() =>
              run(
                () => sendFeatureFeedback({ feature, rating, message, page: pathname }),
                (result) => {
                  toast.success(result.message ?? "Thanks.")
                  setOpen(false)
                  setRating(null)
                  setMessage("")
                },
              )
            }
          >
            {pending ? "Sending…" : "Send feedback"}
          </button>
        }
      >
        <div role="radiogroup" aria-label="Rating" className="grid grid-cols-2 gap-2">
          {RATINGS.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={rating === key} onClick={() => setRating(rating === key ? null : key)} className={cn("rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors", rating === key ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Anything you would change? <span className="font-normal text-muted-foreground">Optional.</span>
          <textarea className={cn(fieldClass, "h-28 resize-none py-2")} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </Sheet>
    </>
  )
}
