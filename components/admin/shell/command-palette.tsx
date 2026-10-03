"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowRight, CornerDownLeft, FileSearch, Loader2, Search, type LucideIcon } from "lucide-react"
import { searchAdmin } from "@/app/actions/admin-shell"
import type { SearchHit } from "@/lib/admin/command-center"
import type { NavIcon } from "@/lib/admin/nav"
import { NAV_ICONS } from "@/components/admin/shell/nav-icons"
import { cn } from "@/lib/utils"

export type PaletteLink = { href: string; label: string; icon: NavIcon }

type Row = { id: string; section: string; title: string; detail?: string; href: string; icon: LucideIcon }

const GROUP_ICONS: Record<string, NavIcon> = {
  Users: "users",
  "Support requests": "support",
  Payouts: "billing",
  Affiliates: "affiliates",
  Billing: "billing",
  "Broker accounts": "brokers",
  "Prop accounts": "propRules",
  Trades: "analytics",
  Announcements: "announcements",
  "Audit log": "audit",
}

// Ctrl/⌘ K: jump to any admin page, or find a user, support request, payout,
// affiliate, subscription, broker or prop account, trade, announcement or
// audit entry. Results come from the database, limited to what the admin's
// role can see; nothing here is made up.
export function CommandPalette({ open, onOpenChange, pages, actions }: { open: boolean; onOpenChange: (open: boolean) => void; pages: PaletteLink[]; actions: PaletteLink[] }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [active, setActive] = useState(0)
  const request = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setHits([])
      setStatus("idle")
      setActive(0)
    }
  }, [open])

  // Search as you type, a beat after the last key; a slow answer to an older query is dropped.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setHits([])
      setStatus("idle")
      return
    }
    setStatus("loading")
    const id = ++request.current
    const timer = setTimeout(() => {
      searchAdmin(term)
        .then((result) => {
          if (id !== request.current) return
          setHits(result)
          setStatus("idle")
        })
        .catch(() => id === request.current && setStatus("error"))
    }, 220)
    return () => clearTimeout(timer)
  }, [query])

  const rows = useMemo<Row[]>(() => {
    const term = query.trim().toLowerCase()
    const pageRows = (term ? pages.filter((p) => p.label.toLowerCase().includes(term)) : pages).map((p) => ({ id: `page:${p.href}`, section: "Pages", title: `Go to ${p.label}`, href: p.href, icon: NAV_ICONS[p.icon] }))
    if (!term) return [...actions.map((a) => ({ id: `action:${a.href}`, section: "Quick actions", title: a.label, href: a.href, icon: NAV_ICONS[a.icon] })), ...pageRows]
    return [...pageRows, ...hits.map((h) => ({ id: h.key, section: h.group, title: h.title, detail: h.detail, href: h.href, icon: NAV_ICONS[GROUP_ICONS[h.group] ?? "overview"] }))]
  }, [query, pages, actions, hits])

  useEffect(() => setActive(0), [rows.length, query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  const go = (row: Row | undefined) => {
    if (!row) return
    onOpenChange(false)
    router.push(row.href)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(rows[active])
    }
  }

  const term = query.trim()
  let lastSection = ""

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 duration-100 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-black/50" />
        <DialogPrimitive.Popup
          aria-label="Search the admin"
          className="fixed inset-0 z-50 flex flex-col bg-popover text-popover-foreground outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:inset-x-0 sm:top-[12vh] sm:bottom-auto sm:mx-auto sm:max-h-[min(560px,76vh)] sm:w-[min(640px,calc(100vw-2rem))] sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-foreground/10 sm:data-open:zoom-in-[0.98]"
        >
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search users, trades, tickets, payouts…"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="admin-palette-list"
              aria-activedescendant={rows[active] ? `palette-${active}` : undefined}
              className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            {status === "loading" && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Searching" />}
            <DialogPrimitive.Close className="shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
              <span className="sm:hidden">Close</span>
              <span className="hidden sm:inline">Esc</span>
            </DialogPrimitive.Close>
          </div>

          <div ref={listRef} id="admin-palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
            {rows.map((row, i) => {
              const heading = row.section !== lastSection ? row.section : null
              lastSection = row.section
              const Icon = row.icon
              return (
                <div key={row.id}>
                  {heading && <p className="px-2.5 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase first:pt-1">{heading}</p>}
                  <div
                    id={`palette-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(row)}
                    className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === active ? "bg-primary/10 text-foreground dark:bg-primary/15" : "text-foreground/90")}
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background", i === active && "border-primary/30 text-primary")} aria-hidden>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.title}</span>
                      {row.detail && <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>}
                    </span>
                    {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/0" aria-hidden />}
                  </div>
                </div>
              )
            })}
            {term.length >= 2 && status === "idle" && rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
                <FileSearch className="size-6" aria-hidden />
                No results for &ldquo;{term}&rdquo;.
              </div>
            )}
            {status === "error" && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Search isn&apos;t available right now. Pages above still work.</p>}
            {term.length === 1 && <p className="px-3 py-3 text-center text-xs text-muted-foreground">Keep typing to search users, requests, payouts and more.</p>}
          </div>

          <div className="hidden items-center gap-4 border-t px-4 py-2.5 text-[11px] text-muted-foreground sm:flex">
            <span><kbd className="rounded border bg-muted px-1 font-sans">↑</kbd> <kbd className="rounded border bg-muted px-1 font-sans">↓</kbd> to move</span>
            <span><kbd className="rounded border bg-muted px-1 font-sans">Enter</kbd> to open</span>
            <span><kbd className="rounded border bg-muted px-1 font-sans">Esc</kbd> to close</span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
