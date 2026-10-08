"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toPng } from "html-to-image"
import { toast } from "sonner"
import { Copy, Download, Eye, ImageIcon, LayoutGrid, Link2, Loader2, Lock, Monitor, RectangleHorizontal, Share2, Smartphone, Trash2, X as XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { createPnlCard, deletePnlCard, listPnlCards, openPnlCard, updatePnlCard } from "@/app/actions/pnl-cards"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FitToWidth } from "@/components/fit-to-width"
import {
  LAYOUT_INFO,
  PERIODS,
  PERIOD_LABELS,
  PNL_LAYOUTS,
  VISIBILITY_FIELDS,
  cardFileName,
  cardSubtitle,
  layoutSupports,
  sharePath,
  xShareUrl,
  type PnlCardLayout,
  type PnlCardPrivacy,
  type PnlCardScope,
  type PnlCardSummary,
  type PnlCardView,
  type PnlCardVisibility,
  type PnlPeriodKey,
  type VisibilityKey,
} from "@/lib/pnl-cards/model"
import { CARD_WIDTH, PnlCard } from "./card"

// PNL Cards, start to finish: pick a layout, the card is made (a snapshot of
// the figures as they stand), then share it or shape the image. Opened by
// whatever page has accounts to make a card of, with which accounts those are;
// the server works the accounts out again from the trader's own.
//
// The editor keeps the card in one place. A change shows on the preview at
// once and is saved a moment later; who may open the card is saved before
// anything else is allowed to happen with it.

const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border bg-background px-3.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
const btnPrimary = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
const eyebrow = "text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
const LAYOUT_ICON: Record<PnlCardLayout, typeof Monitor> = { desktop: Monitor, mobile: Smartphone, "pnl-only": RectangleHorizontal }
const shareUrlOf = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}${sharePath(token)}`

export function PnlCardFlow({ scope, onClose }: { scope: PnlCardScope; onClose: () => void }) {
  const [card, setCard] = useState<PnlCardView | null>(null)
  if (card) return <ShareDialog card={card} onClose={onClose} onBack={() => setCard(null)} />
  return <LayoutDialog scope={scope} onClose={onClose} onCard={setCard} />
}

// ------------------------------------------------------------------ 1. pick a card layout

// What each layout is, drawn small: a shape to choose by, not a card with figures on it.
function LayoutThumb({ layout }: { layout: PnlCardLayout }) {
  const bar = "rounded-full bg-white/80"
  const dim = "rounded-full bg-white/30"
  const base = "relative overflow-hidden rounded-lg bg-gradient-to-br from-[#131038] to-[#3327a8] shadow-md"
  if (layout === "mobile")
    return (
      <div className={cn(base, "h-24 w-14 p-2")} aria-hidden>
        <div className={cn(dim, "h-1 w-6")} />
        <div className={cn(bar, "mt-2 h-1.5 w-8")} />
        <div className="mt-2 space-y-1 rounded bg-white/10 p-1">
          <div className={cn(dim, "h-0.5 w-full")} />
          <div className={cn(dim, "h-0.5 w-full")} />
          <div className={cn(dim, "h-0.5 w-2/3")} />
        </div>
        <div className="absolute end-1.5 bottom-1.5 size-2 rounded-[2px] bg-white/90" />
      </div>
    )
  if (layout === "pnl-only")
    return (
      <div className={cn(base, "h-14 w-32 p-2.5")} aria-hidden>
        <div className={cn(dim, "h-1 w-8")} />
        <div className={cn(bar, "mt-2 h-2 w-16")} />
        <div className={cn(dim, "mt-2 h-1 w-10")} />
        <div className="absolute end-2 bottom-2 size-2.5 rounded-[2px] bg-white/90" />
      </div>
    )
  return (
    <div className={cn(base, "h-20 w-32 p-2.5")} aria-hidden>
      <div className="flex items-center justify-between">
        <div className={cn(dim, "h-1 w-8")} />
        <div className={cn(dim, "h-1 w-4")} />
      </div>
      <div className={cn(bar, "mt-2 h-2 w-14")} />
      <div className="mt-2 space-y-1 rounded bg-white/10 p-1">
        <div className={cn(dim, "h-0.5 w-full")} />
        <div className={cn(dim, "h-0.5 w-full")} />
      </div>
      <div className="absolute end-2 bottom-2 size-2.5 rounded-[2px] bg-white/90" />
    </div>
  )
}

function LayoutDialog({ scope, onClose, onCard }: { scope: PnlCardScope; onClose: () => void; onCard: (card: PnlCardView) => void }) {
  const [layout, setLayout] = useState<PnlCardLayout>("desktop")
  const [period, setPeriod] = useState<PnlPeriodKey>("today")
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<PnlCardSummary[] | null>(null)
  const [working, setWorking] = useState<number | null>(null)
  useEffect(() => {
    let stale = false
    listPnlCards()
      .then((res) => !stale && setSaved(res.ok ? res.cards : []))
      .catch(() => !stale && setSaved([]))
    return () => {
      stale = true
    }
  }, [])

  const create = async () => {
    if (busy) return
    setBusy(true)
    const res = await createPnlCard({ scope, period, layout }).catch(() => null)
    setBusy(false)
    if (!res?.ok) return void toast.error(res?.error ?? "Unable to create PNL card. Please try again.")
    toast.success("PNL card created")
    onCard(res.card)
  }
  const open = async (id: number) => {
    setWorking(id)
    const res = await openPnlCard(id).catch(() => null)
    setWorking(null)
    if (!res?.ok) return void toast.error(res?.error ?? "Unable to open the card. Please try again.")
    onCard(res.card)
  }
  const remove = async (id: number) => {
    setWorking(id)
    const res = await deletePnlCard(id).catch(() => null)
    setWorking(null)
    if (!res?.ok) return void toast.error(res?.error ?? "Unable to delete the card. Please try again.")
    setSaved((list) => (list ?? []).filter((c) => c.id !== id))
    toast.success("Card deleted. Its link no longer works.")
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[94svh] gap-0 overflow-y-auto p-0 sm:max-w-2xl" showCloseButton={false}>
        <header className="relative overflow-hidden rounded-t-xl bg-gradient-to-br from-primary/25 via-primary/10 to-transparent px-5 pt-5 pb-5 sm:px-6">
          <button type="button" aria-label="Close" onClick={onClose} className="absolute end-3 top-3 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <XIcon className="size-4" aria-hidden />
          </button>
          <p className={cn(eyebrow, "flex items-center gap-2 text-primary")}>
            <LayoutGrid className="size-3.5" aria-hidden /> PNL Cards
          </p>
          <DialogTitle className="mt-1.5 text-xl font-bold tracking-tight">Pick a card layout</DialogTitle>
          <DialogDescription className="mt-1 max-w-md text-sm">Choose the format for this snapshot. You can create another one in a different layout any time.</DialogDescription>
        </header>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">Card layouts</p>
              <p className="text-xs text-muted-foreground">Saved · shareable link</p>
            </div>
            <div role="radiogroup" aria-label="Card layout" className="mt-2.5 grid gap-3 sm:grid-cols-3">
              {PNL_LAYOUTS.map((key) => {
                const on = layout === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setLayout(key)}
                    className={cn(
                      "group flex flex-col rounded-xl border p-3 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      on ? "border-primary bg-primary/[0.07] ring-1 ring-primary" : "hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    <span className="flex h-28 items-center justify-center rounded-lg bg-muted/50">
                      <LayoutThumb layout={key} />
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{LAYOUT_INFO[key].label}</span>
                      <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-primary" : "border-muted-foreground/50")}>
                        {on && <span className="size-2 rounded-full bg-primary" />}
                      </span>
                    </span>
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">{LAYOUT_INFO[key].description}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">Period</p>
              <p className="text-xs text-muted-foreground">Closed trades, from your journal</p>
            </div>
            <div role="radiogroup" aria-label="Period" className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-4">
              {PERIODS.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={period === key} onClick={() => setPeriod(key)} className={cn("h-8 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", period === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {PERIOD_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          {saved && saved.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Your cards</p>
              <ul className="mt-2 divide-y rounded-xl border">
                {saved.map((c) => {
                  const Icon = LAYOUT_ICON[c.layout]
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {LAYOUT_INFO[c.layout].label} · {c.scopeLabel}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Created {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {c.privacy === "public" ? "Public" : "Private"}
                        </span>
                      </span>
                      <button type="button" disabled={working != null} className={cn(btn, "h-8 px-2.5 text-xs")} onClick={() => open(c.id)}>
                        {working === c.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : "Open"}
                      </button>
                      <button type="button" disabled={working != null} aria-label="Delete this card" className={cn(btn, "h-8 w-8 px-0 text-[var(--loss)]")} onClick={() => remove(c.id)}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <footer className="grid grid-cols-2 gap-3 border-t px-5 py-4 sm:px-6">
          <button type="button" className={cn(btn, "h-10")} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={cn(btnPrimary, "h-10")} onClick={create}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? "Creating…" : "Create card"}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ 2. share pnl card

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:opacity-50", checked ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "start-[22px]" : "start-0.5")} />
    </button>
  )
}

function ShareDialog({ card: initial, onClose, onBack }: { card: PnlCardView; onClose: () => void; onBack: () => void }) {
  const [card, setCard] = useState(initial)
  const [tab, setTab] = useState<"share" | "image">("share")
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [downloading, setDownloading] = useState(false)
  const [big, setBig] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const url = shareUrlOf(card.token)
  const isPrivate = card.privacy === "private"

  // What has been changed and not yet saved: sent together a moment after the last change.
  const pending = useRef<{ layout?: PnlCardLayout; visibility?: PnlCardVisibility; privacy?: PnlCardPrivacy }>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const patch = pending.current
    if (!Object.keys(patch).length) return true
    pending.current = {}
    setSaving("saving")
    const res = await updatePnlCard(initial.id, patch).catch(() => null)
    if (!res?.ok) {
      setSaving("error")
      toast.error(res?.error ?? "Unable to save the card. Please try again.")
      return false
    }
    setSaving("saved")
    return true
  }, [initial.id])
  const change = (patch: { layout?: PnlCardLayout; visibility?: PnlCardVisibility; privacy?: PnlCardPrivacy }, now = false) => {
    setCard((c) => ({ ...c, ...patch }))
    pending.current = { ...pending.current, ...patch }
    if (timer.current) clearTimeout(timer.current)
    if (now) return flush()
    timer.current = setTimeout(() => void flush(), 500)
    return Promise.resolve(true)
  }
  // nothing a trader changed is lost by closing the window a moment early
  useEffect(() => () => void flush(), [flush])

  const toggle = (key: VisibilityKey) => change({ visibility: { ...card.visibility, [key]: !card.visibility[key] } })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Link copied", { description: isPrivate ? "Only you can open it while the card is private." : undefined })
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }
  const shareOnX = async () => {
    if (isPrivate) return void toast.error("This card is private.", { description: "Make it public before sharing." })
    // what is shared is what is saved: the link opens the card as the server has it
    if (!(await flush())) return
    window.open(xShareUrl(card, url), "_blank", "noopener,noreferrer")
    toast.success("Card shared")
  }
  const download = async () => {
    if (!cardRef.current || downloading) return
    setDownloading(true)
    try {
      // the card at its own size, three times over: sharp on a phone and on X
      const data = await toPng(cardRef.current, { pixelRatio: 3, cacheBust: true })
      const link = document.createElement("a")
      link.download = cardFileName(card.data.exportedAt)
      link.href = data
      link.click()
      toast.success("Card downloaded")
    } catch {
      toast.error("We couldn't generate your card image.", { description: "Please try again." })
    } finally {
      setDownloading(false)
    }
  }

  const preview = <PnlCard data={card.data} layout={card.layout} visibility={card.visibility} shareUrl={url} />
  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="flex h-[100svh] max-h-[100svh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[94svh] sm:max-w-[min(68rem,calc(100%-2rem))] sm:rounded-xl" showCloseButton={false}>
          <header className="flex items-start gap-3 border-b px-4 py-3.5 sm:px-6">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-bold tracking-tight">Share PNL Card</DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-sm">{cardSubtitle(card.data)}</DialogDescription>
            </div>
            <span role="status" className="mt-1 hidden text-xs text-muted-foreground sm:block">
              {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Not saved" : ""}
            </span>
            <button type="button" aria-label="Close" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <XIcon className="size-4" aria-hidden />
            </button>
          </header>

          {/* One column on a phone, in the order it is used: format, preview, settings. Two where there is room: the controls on the left, the card on the right for the whole height. */}
          <div className="grid min-h-0 flex-1 content-start gap-0 overflow-y-auto lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
            {/* ---------------------------------------------- the controls */}
            <div className="order-1 min-w-0 space-y-4 px-4 pt-4 sm:px-6 lg:col-start-1 lg:row-start-1 lg:pt-5">
              <div role="tablist" aria-label="Card settings" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(
                  [
                    ["share", "Share", Share2],
                    ["image", "Image", ImageIcon],
                  ] as const
                ).map(([key, text, Icon]) => (
                  <button key={key} type="button" role="tab" id={`pnl-tab-${key}`} aria-selected={tab === key} aria-controls={`pnl-panel-${key}`} onClick={() => setTab(key)} className={cn("flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <Icon className="size-3.5" aria-hidden /> {text}
                  </button>
                ))}
              </div>

              <div>
                <p className={eyebrow}>Format</p>
                <div role="radiogroup" aria-label="Format" className="mt-2 grid grid-cols-3 gap-1 rounded-lg border p-1">
                  {PNL_LAYOUTS.map((key) => {
                    const Icon = LAYOUT_ICON[key]
                    return (
                      <button key={key} type="button" role="radio" aria-checked={card.layout === key} onClick={() => card.layout !== key && change({ layout: key })} className={cn("flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", card.layout === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                        <Icon className="size-3.5 shrink-0" aria-hidden /> {LAYOUT_INFO[key].label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ---------------------------------------------- the preview: beside the controls where there is room, under the format on a phone */}
            <div className="order-2 min-w-0 px-4 pt-4 sm:px-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-s lg:py-5">
              <p className={cn(eyebrow, "text-center")}>Preview</p>
              <div className="mt-2 rounded-2xl border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] p-4 [background-size:14px_14px] sm:p-6">
                <FitToWidth width={CARD_WIDTH[card.layout]} className={card.layout === "mobile" ? "mx-auto max-w-[22rem]" : undefined}>
                  <div ref={cardRef}>{preview}</div>
                </FitToWidth>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">This is the image, exactly as it downloads.</p>
            </div>

            <div className="order-3 min-w-0 space-y-4 px-4 py-4 sm:px-6 lg:col-start-1 lg:row-start-2 lg:pb-5">
              {tab === "share" ? (
                <div role="tabpanel" id="pnl-panel-share" aria-labelledby="pnl-tab-share" className="space-y-4">
                  <div>
                    <p className={eyebrow}>Share link</p>
                    <div className="mt-2 flex gap-1.5">
                      <input readOnly aria-label="Share link" value={url.replace(/^https?:\/\//, "")} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-lg border bg-muted/40 px-3 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />
                      <button type="button" className={cn(btn, "h-10 shrink-0")} onClick={copy}>
                        <Copy className="size-3.5" aria-hidden /> Copy link
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl border p-3.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        {isPrivate ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : <Link2 className="size-3.5 text-primary" aria-hidden />}
                        {isPrivate ? "Private card" : "Shared card"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{isPrivate ? "Only you can open the card. Switch on to share." : "Anyone with the link can open the card. Switch off to make it private again."}</p>
                    </div>
                    <Switch checked={!isPrivate} label="Share this card with anyone who has the link" onChange={(on) => void change({ privacy: on ? "public" : "private" }, true).then((ok) => ok && toast.success(on ? "Card shared: anyone with the link can open it." : "Card is private again."))} />
                  </div>
                  <p className="text-xs text-muted-foreground">The figures are closed trades from your journal, as they stood when the card was made. Make a new card for newer figures.</p>
                </div>
              ) : (
                <div role="tabpanel" id="pnl-panel-image" aria-labelledby="pnl-tab-image">
                  <p className={eyebrow}>On the image</p>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Choose what information appears on the downloaded PNL card. Turning something off only hides it from the image. The card and trading data remain unchanged.</p>
                  <div className="mt-3 grid grid-cols-1 gap-x-4 rounded-xl border p-2 sm:grid-cols-2">
                    {VISIBILITY_FIELDS.map(({ key, label }) => {
                      const supported = layoutSupports(card.layout, key)
                      return (
                        <label key={key} title={supported ? undefined : "Not on the PNL only card"} className={cn("flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors", supported ? "cursor-pointer hover:bg-muted/60" : "cursor-not-allowed opacity-45")}>
                          <Checkbox checked={supported && card.visibility[key]} disabled={!supported} onCheckedChange={() => supported && void toggle(key)} className="data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground" />
                          <span className="min-w-0 truncate font-medium">{label}</span>
                        </label>
                      )
                    })}
                  </div>
                  {card.layout === "pnl-only" && <p className="mt-2 text-xs text-muted-foreground">The PNL only card has no room for accounts or trade figures: those are for the Desktop and Mobile cards.</p>}
                </div>
              )}
            </div>
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t bg-background px-4 py-3 sm:justify-end sm:px-6">
            <button type="button" className={cn(btn, "me-auto hidden sm:inline-flex")} onClick={onBack}>
              New card
            </button>
            <button type="button" className={cn(btn, "flex-1 sm:flex-none")} onClick={() => setBig(true)}>
              <Eye className="size-3.5" aria-hidden /> Preview card
            </button>
            <button type="button" className={cn(btn, "flex-1 sm:flex-none")} onClick={shareOnX}>
              <span aria-hidden className="text-[13px] font-bold">
                𝕏
              </span>{" "}
              Share on X
            </button>
            <button type="button" disabled={downloading} className={cn(btnPrimary, "w-full sm:w-auto")} onClick={download}>
              {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
              {downloading ? "Generating…" : "Download card"}
            </button>
          </footer>
        </DialogContent>
      </Dialog>

      {/* the same card, larger: nothing about it is different */}
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="max-h-[96svh] gap-3 overflow-y-auto sm:max-w-[min(56rem,calc(100%-2rem))]">
          <DialogTitle className="text-base font-semibold">Preview</DialogTitle>
          <DialogDescription className="sr-only">The PNL card at full size</DialogDescription>
          <FitToWidth width={CARD_WIDTH[card.layout]} className={card.layout === "mobile" ? "mx-auto max-w-[26rem]" : undefined}>
            {preview}
          </FitToWidth>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setBig(false)}>
              Close
            </button>
            <button type="button" disabled={downloading} className={btnPrimary} onClick={download}>
              <Download className="size-4" aria-hidden /> Download
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
