"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, CheckCheck, CircleDollarSign, Link2, Loader2, Plus, Search, Share2, Target, Wallet, Zap } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { markNotificationsRead } from "@/app/actions/affiliate"
import { searchAffiliatePortal } from "@/app/actions/affiliate-v2"
import type { PortalHit } from "@/lib/affiliates/v2/server"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { affiliateHref, portalHref } from "@/lib/urls"
import { V2_EXTRA, V2_NAV, type V2NavItem } from "./nav"
import { cn } from "@/lib/utils"

export type V2Notification = { id: number; title: string; body: string | null; href: string | null; read: boolean; at: string }

const iconBtn = "relative inline-flex size-10 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:border-border aria-expanded:bg-card aria-expanded:text-foreground"

// --- Notifications --------------------------------------------------------------

export function NotificationsBell({ items, unread: initialUnread }: { items: V2Notification[]; unread: number }) {
  const router = useRouter()
  const [unread, setUnread] = useState(initialUnread)
  const [read, setRead] = useState(false)
  useEffect(() => setUnread(initialUnread), [initialUnread])
  const markAll = () => {
    setUnread(0)
    setRead(true)
    markNotificationsRead()
      .then(() => router.refresh())
      .catch(() => setUnread(initialUnread))
  }
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" className={iconBtn} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} />}>
        <Bell className="size-[18px]" aria-hidden />
        {unread > 0 && (
          <span className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-[#d946ef] to-[#7c3aed] px-1 text-[9px] leading-none font-bold text-white ring-2 ring-background" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(380px,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button type="button" onClick={markAll} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
              <CheckCheck className="size-3.5" aria-hidden /> Mark all as read
            </button>
          )}
        </div>
        <ul className="max-h-[min(420px,60vh)] divide-y overflow-y-auto">
          {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">No notifications yet.</li>}
          {items.map((n) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !n.read && !read ? "font-semibold" : "font-medium")}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{n.at}</span>
                </span>
                {!n.read && !read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gradient-to-r from-[#d946ef] to-[#7c3aed]" aria-label="Unread" />}
              </>
            )
            return (
              <li key={n.id}>
                {n.href ? (
                  <Link href={portalHref(n.href)} className="flex gap-3 px-4 py-3 hover:bg-muted/60">
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-3 px-4 py-3">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
        <div className="border-t p-1.5">
          <Link href={affiliateHref("/affiliate/v2/activity")} className="flex h-9 items-center justify-center rounded-md text-sm font-medium text-primary hover:bg-primary/10">
            View all activity
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// --- Search -----------------------------------------------------------------------

type Row = { id: string; group: string; title: string; detail?: string; href: string }

export function SearchButton({ features, compact }: { features: Record<string, boolean>; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} className={iconBtn} aria-label="Search">
          <Search className="size-[18px]" aria-hidden />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full max-w-[280px] items-center gap-2 rounded-xl border bg-card/70 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate text-start">Search…</span>
          <kbd className="hidden rounded border bg-background px-1.5 font-sans text-[10px] xl:inline">Ctrl K</kbd>
        </button>
      )}
      <SearchDialog open={open} onOpenChange={setOpen} features={features} />
    </>
  )
}

function SearchDialog({ open, onOpenChange, features }: { open: boolean; onOpenChange: (o: boolean) => void; features: Record<string, boolean> }) {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<PortalHit[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    if (!open) {
      setQ("")
      setHits([])
    }
  }, [open])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return setHits([])
    setLoading(true)
    const id = ++seq.current
    const t = setTimeout(() => {
      searchAffiliatePortal(term)
        .then((r) => id === seq.current && setHits(r))
        .catch(() => id === seq.current && setHits([]))
        .finally(() => id === seq.current && setLoading(false))
    }, 220)
    return () => clearTimeout(t)
  }, [q])
  const pages = [...V2_NAV, ...V2_EXTRA].filter((p: V2NavItem) => !p.feature || features[p.feature] !== false)
  const rows = useMemo<Row[]>(() => {
    const term = q.trim().toLowerCase()
    const pageRows = pages.filter((p) => !term || p.label.toLowerCase().includes(term)).map((p) => ({ id: p.key, group: "Pages", title: p.label, href: p.href }))
    return [...pageRows, ...hits.map((h) => ({ id: h.key, group: h.group, title: h.title, detail: h.detail, href: h.href }))]
  }, [q, hits, pages])
  useEffect(() => setActive(0), [rows.length])
  const go = (r?: Row) => {
    if (!r) return
    onOpenChange(false)
    router.push(affiliateHref(r.href))
  }
  let last = ""
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup aria-label="Search" className="fixed inset-0 z-50 flex flex-col bg-popover text-popover-foreground outline-none data-open:animate-in data-open:fade-in-0 sm:inset-x-0 sm:top-[12vh] sm:bottom-auto sm:mx-auto sm:max-h-[min(520px,76vh)] sm:w-[min(600px,calc(100vw-2rem))] sm:rounded-2xl sm:border sm:shadow-2xl">
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-[18px] text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => Math.min(rows.length - 1, i + 1)))
                else if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => Math.max(0, i - 1)))
                else if (e.key === "Enter") (e.preventDefault(), go(rows[active]))
              }}
              placeholder="Search pages, referrals (TL-…), campaigns, payouts (#…)"
              aria-label="Search"
              className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />}
            <DialogPrimitive.Close className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">Esc</DialogPrimitive.Close>
          </div>
          <div role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
            {rows.map((r, i) => {
              const head = r.group !== last ? r.group : null
              last = r.group
              return (
                <div key={r.id}>
                  {head && <p className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase first:pt-1">{head}</p>}
                  <div role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => go(r)} className={cn("flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-2", i === active && "bg-primary/10")}>
                    <span className="text-sm font-medium">{r.title}</span>
                    {r.detail && <span className="text-xs text-muted-foreground">{r.detail}</span>}
                  </div>
                </div>
              )
            })}
            {q.trim().length >= 2 && !loading && rows.length === 0 && <p className="px-3 py-10 text-center text-sm text-muted-foreground">No results for &ldquo;{q.trim()}&rdquo;.</p>}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// --- Quick actions ----------------------------------------------------------------

export function useShareLink(url: string) {
  return async () => {
    const data = { title: "TradeLoop", text: "I'm using TradeLoop to journal and analyze my trades. Try it here:", url }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(data)
        return
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Referral link copied!")
    } catch {
      toast.error("Couldn't copy the link. Long-press it to copy.")
    }
  }
}

export function QuickActions({ referralUrl, wallet, variant }: { referralUrl: string; wallet: boolean; variant: "header" | "fab" }) {
  const router = useRouter()
  const share = useShareLink(referralUrl)
  const [, start] = useTransition()
  const items = [
    { key: "link", label: "Create link", icon: Link2, run: () => router.push(affiliateHref("/affiliate/v2/links?new=1")) },
    { key: "share", label: "Share referral", icon: Share2, run: () => start(share) },
    { key: "withdraw", label: "Withdraw", icon: Wallet, run: () => router.push(affiliateHref(wallet ? "/affiliate/v2/wallet?withdraw=1" : "/affiliate/v2/payouts?withdraw=1")) },
    { key: "earnings", label: "View earnings", icon: CircleDollarSign, run: () => router.push(affiliateHref("/affiliate/v2/earnings")) },
    { key: "campaign", label: "Create campaign", icon: Target, run: () => router.push(affiliateHref("/affiliate/v2/campaigns?new=1")) },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          variant === "fab" ? (
            <button type="button" aria-label="Quick actions" className="v2-btn fixed end-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 inline-flex size-14 items-center justify-center rounded-full md:end-6 md:bottom-6 lg:hidden" />
          ) : (
            <button type="button" className="v2-btn hidden h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold lg:inline-flex" />
          )
        }
      >
        {variant === "fab" ? <Zap className="size-6" aria-hidden /> : <><Plus className="size-4" aria-hidden /> Quick actions</>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={variant === "fab" ? "top" : "bottom"} sideOffset={8} className="w-56">
        {items.map((i) => (
          <DropdownMenuItem key={i.key} onClick={i.run} className="min-h-11">
            <i.icon aria-hidden /> {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
