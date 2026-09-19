"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getRecentSyncEvents, type SyncEvent } from "@/app/actions/sync-events"
import { Check, X } from "lucide-react"
import { useDir, useT } from "@/components/locale-provider"

// How often the banner asks the server whether anything new synced. A sync is
// a background job the page has no way to hear about, so without this the
// toast only ever appeared on a reload.
const POLL_MS = 15_000

// How long a toast stays before dismissing itself. Long enough to read and
// act on, short enough that the corner doesn't collect clutter.
const AUTO_DISMISS_MS = 45_000

// A connection's event id is stable across syncs, so the sync time is part of
// the key. Without it, a second sync on the same connection would reuse a key
// the trader had already dismissed and never show.
const keyOf = (event: SyncEvent) => `${event.id}@${event.syncedAt}`

export function AutoSyncBanner({ events: initialEvents }: { events: SyncEvent[] }) {
  const [events, setEvents] = useState(initialEvents)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [closing, setClosing] = useState<Set<string>>(new Set())

  // Server-rendered events are the starting point; later page renders (a
  // router.refresh elsewhere) should still win over stale polled state.
  useEffect(() => setEvents(initialEvents), [initialEvents])

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return
    try {
      setEvents(await getRecentSyncEvents())
    } catch {
      // Signed out, offline, or a transient failure — the next tick retries.
      // A sync toast is never worth showing an error over.
    }
  }, [])

  useEffect(() => {
    const id = setInterval(poll, POLL_MS)
    // Coming back to the tab is the most likely moment for something to have
    // synced while it was hidden, so check immediately instead of waiting.
    document.addEventListener("visibilitychange", poll)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", poll)
    }
  }, [poll])

  function dismiss(key: string) {
    // Collapse first, then drop it — so the toasts above glide down into the
    // gap rather than snapping.
    setClosing((prev) => new Set(prev).add(key))
    setTimeout(() => {
      setDismissed((prev) => new Set(prev).add(key))
      setClosing((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, 420)
  }

  const visible = events.filter((event) => !dismissed.has(keyOf(event)))
  if (visible.length === 0) return null

  return (
    // Anchored to the viewport edge and clipped there, so a toast translated
    // off to the right is genuinely off-screen (and never creates a horizontal
    // scrollbar). The right padding keeps the visual gap from the edge.
    <div className="pointer-events-none fixed end-0 bottom-4 z-50 flex w-[23rem] flex-col-reverse items-end overflow-hidden pe-4">
      {visible.map((event) => {
        const key = keyOf(event)
        return <Toast key={key} event={event} closing={closing.has(key)} onDismiss={() => dismiss(key)} />
      })}
    </div>
  )
}

function Toast({ event, closing, onDismiss }: { event: SyncEvent; closing: boolean; onDismiss: () => void }) {
  const t = useT()
  const dir = useDir()
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const raf = useRef<number | undefined>(undefined)

  // The parent passes a fresh closure every render, so the auto-dismiss timer
  // reads it through a ref — otherwise the effect would tear down and restart
  // the countdown on each render and the toast would never leave.
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  // Mount collapsed, then expand on the next frame. Animating the row's height
  // from 0fr to 1fr is what physically pushes the toasts above it upward —
  // a transition on the toast alone can't move its siblings.
  useEffect(() => {
    raf.current = requestAnimationFrame(() => setOpen(true))
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current)
    }
  }, [])

  // Hovering pauses the countdown and restarts it on leave, so a toast can't
  // vanish out from under the pointer while it's being read.
  useEffect(() => {
    if (hovered) return
    const timer = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [hovered])

  const shown = open && !closing

  return (
    // Two nested animations doing different jobs: the outer one slides the
    // whole toast in from off-screen right, the inner one grows its row from
    // 0fr to 1fr, which is what pushes the toasts above it upward. The slide
    // has to sit outside the clipping wrapper, or the collapse's
    // overflow-hidden would eat it.
    <div
      className="transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1.4,0.36,1)] motion-reduce:transition-none"
      style={{ transform: shown ? "translateX(0) scale(1)" : `translateX(${dir === "rtl" ? "-115%" : "115%"}) scale(0.96)`, opacity: shown ? 1 : 0 }}
    >
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: shown ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="pointer-events-auto mt-2 flex w-80 items-center gap-3 rounded-xl border bg-popover p-4 shadow-lg"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--gain)]/15 text-[var(--gain)]">
              <Check className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("Auto-sync successful")}</p>
              <p className="mt-0.5 truncate text-sm font-bold text-popover-foreground">
                {event.count === 1 ? t("1 trade pulled from {source}", { source: event.source }) : t("{n} trades pulled from {source}", { n: event.count, source: event.source })}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("Dismiss")}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
