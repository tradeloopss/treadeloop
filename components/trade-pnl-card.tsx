"use client"

import { useEffect, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { toPng } from "html-to-image"
import { shareTrade } from "@/app/actions/trade-share"
import { formatCurrency } from "@/lib/calc"
import { chipColor, initials } from "@/lib/ui-chips"
import { cn } from "@/lib/utils"
import { ChevronGlow } from "@/components/chevron-glow"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Copy, Download, Printer, Share2, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useIntlLocale, useT } from "@/components/locale-provider"

export interface PnlCardTrade {
  symbol: string
  market: string
  side: string
  status: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  pnl: number
  fees: number
  rMultiple: number | null
  entryTime: string
  exitTime: string | null
}

const MARKET_LABELS: Record<string, string> = {
  futures: "Futures",
  stocks: "Stock",
  options: "Option",
  future_option: "Future Opt.",
  forex: "Forex",
  crypto: "Crypto",
  cfd: "CFD",
}

export function TradePnlCard({
  trade,
  traderName,
  traderImage,
  shareUrl,
}: {
  trade: PnlCardTrade
  traderName: string
  traderImage?: string | null
  shareUrl?: string | null
}) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const isWin = trade.pnl >= 0
  const notional = trade.entryPrice * trade.quantity
  const pnlPct = notional > 0 ? (trade.pnl / notional) * 100 : null
  const tone = isWin ? "var(--gain)" : "var(--loss)"
  const SideIcon = trade.side === "long" ? ArrowUpRight : ArrowDownRight

  return (
    <div
      id="pnl-card"
      className="relative w-[360px] overflow-hidden rounded-2xl p-5 text-white shadow-2xl ring-1 ring-white/10"
      style={{ background: "linear-gradient(160deg, #0c1210 0%, #050505 60%)" }}
    >
      <ChevronGlow tone={tone} />
      <div className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full blur-3xl" style={{ background: tone, opacity: 0.16 }} />

      <div className="relative flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md" style={{ background: tone }}>
          <TrendingUp className="size-4 text-black" />
        </div>
        <span className="text-base font-bold tracking-tight">TradeLoop</span>
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
        <span className="text-sm font-semibold text-white">{traderName}</span>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase",
            isWin ? "bg-[var(--gain)]/15 text-[var(--gain)]" : "bg-[var(--loss)]/15 text-[var(--loss)]"
          )}
        >
          <SideIcon className="size-3" /> {trade.side === "long" ? t("Long") : t("Short")}
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 py-1 pe-2.5 ps-1 text-[11px] font-bold text-white/90">
          <span
            className="flex size-4 items-center justify-center rounded-full text-[8px] font-black text-white"
            style={{ background: chipColor(trade.symbol) }}
          >
            {trade.symbol.charAt(0)}
          </span>
          {trade.symbol}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
          {t(MARKET_LABELS[trade.market] ?? trade.market)}
        </span>
        {trade.rMultiple != null && (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
            {trade.rMultiple >= 0 ? "+" : ""}
            {trade.rMultiple.toFixed(1)}R
          </span>
        )}
      </div>

      <div className="relative mt-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">{t("Trade P&L")}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular-nums" style={{ color: tone }}>
            {isWin ? "+" : ""}
            {formatCurrency(trade.pnl)}
          </span>
          {pnlPct != null && (
            <span className="flex items-center gap-0.5 text-sm font-bold tabular-nums" style={{ color: tone }}>
              {isWin ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {isWin ? "+" : ""}
              {pnlPct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-xs">
        <div>
          <p className="text-white/40">{t("Entry Price")}</p>
          <p className="mt-1 font-semibold tabular-nums">{trade.entryPrice}</p>
        </div>
        <div>
          <p className="text-white/40">{t("Exit Price")}</p>
          <p className="mt-1 font-semibold tabular-nums">{trade.status === "open" ? t("Open") : (trade.exitPrice ?? "—")}</p>
        </div>
        <div>
          <p className="text-white/40">{t("Fees")}</p>
          <p className="mt-1 font-semibold tabular-nums text-[var(--gain)]">{formatCurrency(trade.fees)}</p>
        </div>
      </div>

      <div className="relative mt-5 flex items-end justify-between">
        <p className="text-[10px] text-white/35">
          {new Date(trade.entryTime).toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "numeric" })}
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

export function TradePnlShareDialog({
  trade,
  tradeId,
  traderName,
  traderImage,
  open,
  onOpenChange,
}: {
  trade: PnlCardTrade
  tradeId: number
  traderName: string
  traderImage?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const t = useT()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || token) return
    setLoading(true)
    shareTrade(tradeId)
      .then(setToken)
      .catch(() => toast.error(t("Could not create a share link")))
      .finally(() => setLoading(false))
    // Only fetch once per time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : null

  function onCopyLink() {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(
      () => toast.success(t("Link copied")),
      () => toast.error(t("Could not copy link"))
    )
  }

  async function onDownload() {
    if (!cardRef.current) return
    setDownloading(true)
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2 })
      const link = document.createElement("a")
      link.download = `${trade.symbol}-pnl.png`
      link.href = dataUrl
      link.click()
    } catch {
      toast.error(t("Could not generate image"))
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
        await navigator.share({ title: t("{symbol} trade", { symbol: trade.symbol }), url: shareUrl })
      } catch {
        // user cancelled — nothing to do
      }
    } else {
      onCopyLink()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Share this trade")}</DialogTitle>
          <DialogDescription>{t("Anyone with the link (or who scans the QR code) can view this card — no account needed.")}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center py-2">
          <div ref={cardRef}>
            <TradePnlCard trade={trade} traderName={traderName} traderImage={traderImage} shareUrl={shareUrl} />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("Generating link…")}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onCopyLink} disabled={!shareUrl}>
            <Copy className="size-4" /> {t("Copy link")}
          </Button>
          <Button type="button" variant="outline" onClick={onShare} disabled={!shareUrl}>
            <Share2 className="size-4" /> {t("Share")}
          </Button>
          <Button type="button" variant="outline" onClick={onDownload} disabled={downloading}>
            <Download className="size-4" /> {downloading ? t("Saving…") : t("Download PNG")}
          </Button>
          <Button type="button" variant="outline" onClick={onPrint}>
            <Printer className="size-4" /> {t("Print")}
          </Button>
        </div>
      </DialogContent>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pnl-card, #pnl-card * { visibility: visible; }
          #pnl-card { position: fixed; inset: 0; margin: auto; }
        }
      `}</style>
    </Dialog>
  )
}
