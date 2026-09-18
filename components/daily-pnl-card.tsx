"use client"

import { useEffect, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { toPng } from "html-to-image"
import { shareDailyPnl, type BrokerBreakdown } from "@/app/actions/daily-pnl-share"
import type { PnlPeriod } from "@/lib/pnl-period"
import { formatCurrency } from "@/lib/calc"
import { chipColor, initials } from "@/lib/ui-chips"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Copy, Download, Printer, Share2, TrendingUp, BadgeCheck, Loader2 } from "lucide-react"
import { ChevronGlow } from "@/components/chevron-glow"
import { toast } from "sonner"

// The gold the certificates share — same family as the payout card.
const GOLD = "#f0b429"

export interface DailyPnlCardData {
  period: PnlPeriod
  periodLabel: string
  scope: "account" | "all"
  accountName: string | null
  accountCount: number
  breakdown: BrokerBreakdown[]
  currency: string
  date: string
  pnl: number
}

function Triangle({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", up ? "" : "rotate-180")} fill="currentColor">
      <path d="M8 2 L14 13 L2 13 Z" />
    </svg>
  )
}

export function DailyPnlCard({
  data,
  traderName,
  traderImage,
  isPro,
  shareUrl,
  generatedAt,
}: {
  data: DailyPnlCardData
  traderName: string
  traderImage?: string | null
  isPro?: boolean
  shareUrl?: string | null
  generatedAt?: Date
}) {
  const isWin = data.pnl >= 0
  const tone = isWin ? "var(--gain)" : "var(--loss)"
  const rows: BrokerBreakdown[] =
    data.scope === "all" ? data.breakdown : [{ broker: data.accountName ?? "Account", pnl: data.pnl, accounts: 1 }]
  const stamp = generatedAt ?? new Date()

  return (
    <div
      id="daily-pnl-card"
      className="relative w-[400px] max-w-full overflow-hidden rounded-2xl p-5 text-white shadow-2xl ring-1 ring-amber-400/30"
      style={{ background: "linear-gradient(160deg, #15100a 0%, #070604 60%)" }}
    >
      <ChevronGlow tone={GOLD} />
      <div
        className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full blur-3xl"
        style={{ background: GOLD, opacity: 0.16 }}
      />

      <div className="relative flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md" style={{ background: GOLD }}>
          <TrendingUp className="size-4 text-black" />
        </div>
        <span className="text-base font-bold tracking-tight">TradeLoop</span>
        {isPro && (
          <span className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-black">
            PRO
          </span>
        )}
      </div>

      <div className="relative mt-5 flex items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-white/25 to-white/5 text-xs font-bold ring-1 ring-white/10">
          {traderImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={traderImage} alt="" className="size-full object-cover" />
          ) : (
            initials(traderName)
          )}
        </div>
        <span className="truncate text-sm font-semibold text-white">{traderName}</span>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase"
          style={{ background: `${GOLD}26`, color: GOLD }}
        >
          <BadgeCheck className="size-3" /> {data.period === "weekly" ? "Weekly" : "Daily"}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
          {data.periodLabel}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
          {data.scope === "all" ? `${data.accountCount} account${data.accountCount === 1 ? "" : "s"}` : "1 account"}
        </span>
      </div>

      <div className="relative mt-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
          {data.period === "weekly" ? "Weekly" : "Daily"} P&amp;L
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-4xl font-extrabold tabular-nums" style={{ color: tone }}>
            {isWin ? "+" : "-"}
            {formatCurrency(Math.abs(data.pnl), data.currency)}
          </span>
          <span style={{ color: tone }}>
            <Triangle up={isWin} />
          </span>
        </div>
      </div>

      <div className="relative mt-5 border-t border-white/10 pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/40">
          {data.scope === "all" ? "Combined across accounts" : "Account"}
        </p>
        <div className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const rowWin = row.pnl >= 0
            return (
              <div key={row.broker} className="flex items-center justify-between gap-3 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white"
                    style={{ background: chipColor(row.broker) }}
                  >
                    {initials(row.broker)}
                  </span>
                  <span className="truncate font-semibold uppercase tracking-wide text-white/80">{row.broker}</span>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-bold tabular-nums",
                    rowWin ? "text-[var(--gain)]" : "text-[var(--loss)]",
                  )}
                >
                  {rowWin ? "+" : ""}
                  {formatCurrency(row.pnl, data.currency)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="relative mt-5 flex items-end justify-between">
        <p className="text-[10px] text-white/35">
          {stamp.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
        {shareUrl && (
          <div className="rounded-lg bg-white p-1.5">
            <QRCodeSVG value={shareUrl} size={52} />
          </div>
        )}
      </div>
    </div>
  )
}

export function DailyPnlShareDialog({
  accountId,
  data,
  traderName,
  traderImage,
  isPro,
  open,
  onOpenChange,
}: {
  accountId: number | null
  data: DailyPnlCardData
  traderName: string
  traderImage?: string | null
  isPro?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [generatedAt] = useState(() => new Date())
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || token) return
    setLoading(true)
    shareDailyPnl(accountId, data.date, data.period)
      .then(setToken)
      .catch(() => toast.error("Could not create a share link"))
      .finally(() => setLoading(false))
    // Only fetch once per time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : null
  const label = data.scope === "all" ? "all accounts" : (data.accountName ?? "this account")

  function onCopyLink() {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy link"),
    )
  }

  async function onDownload() {
    if (!cardRef.current) return
    setDownloading(true)
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2 })
      const link = document.createElement("a")
      link.download = `${label}-${data.period}-${data.date}-pnl.png`
      link.href = dataUrl
      link.click()
    } catch {
      toast.error("Could not generate image")
    } finally {
      setDownloading(false)
    }
  }

  function onPrint() {
    window.print()
  }

  async function onShare() {
    if (!shareUrl) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${data.period === "weekly" ? "Weekly" : "Daily"} P&L — ${label}`,
          url: shareUrl,
        })
      } catch {
        // user cancelled — nothing to do
      }
    } else {
      onCopyLink()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {data.period === "weekly" ? "this week\u2019s" : "today\u2019s"} P&amp;L</DialogTitle>
          <DialogDescription>
            Anyone with the link (or who scans the QR code) can view this card — no account needed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center py-2">
          <div ref={cardRef}>
            <DailyPnlCard
              data={data}
              traderName={traderName}
              traderImage={traderImage}
              isPro={isPro}
              shareUrl={shareUrl}
              generatedAt={generatedAt}
            />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Generating link…
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onCopyLink} disabled={!shareUrl}>
            <Copy className="size-4" /> Copy link
          </Button>
          <Button type="button" variant="outline" onClick={onShare} disabled={!shareUrl}>
            <Share2 className="size-4" /> Share
          </Button>
          <Button type="button" variant="outline" onClick={onDownload} disabled={downloading}>
            <Download className="size-4" /> {downloading ? "Saving…" : "Download PNG"}
          </Button>
          <Button type="button" variant="outline" onClick={onPrint}>
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </DialogContent>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #daily-pnl-card, #daily-pnl-card * { visibility: visible; }
          #daily-pnl-card { position: fixed; inset: 0; margin: auto; }
        }
      `}</style>
    </Dialog>
  )
}
