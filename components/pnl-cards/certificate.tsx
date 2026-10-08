"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { BadgeCheck, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/calc"
import { brokerLogo } from "@/lib/broker-logos"
import { chipColor, initials } from "@/lib/ui-chips"
import { ChevronGlow } from "@/components/chevron-glow"
import { useT } from "@/components/locale-provider"
import { PERIOD_PNL, certificateRows, exportDate, signedMoney, type PnlCardData, type PnlCardLayout, type PnlCardVisibility } from "@/lib/pnl-cards/model"

// The P&L certificate, as a PNL Card: the dashboard's own gold-on-black design
// (the same marks, chips, figure and broker rows as components/daily-pnl-card.tsx,
// which still draws the certificates shared before this), in the three layouts
// and with the same switches as any other card.
//
// It is given a card that already has everything switched off taken out of it
// (components/pnl-cards/card.tsx does that for both looks), and draws what is
// left. The portrait layout is the certificate as it has always been.

// The gold the certificates share — same family as the payout card.
const GOLD = "#f0b429"
const small = "text-[10px] font-medium tracking-wide uppercase text-white/40"

function Triangle({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", up ? "" : "rotate-180")} fill="currentColor" aria-hidden>
      <path d="M8 2 L14 13 L2 13 Z" />
    </svg>
  )
}

function Frame({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <div data-pnl-card className="relative overflow-hidden rounded-2xl p-5 text-white shadow-2xl ring-1 ring-amber-400/30" style={{ width, background: "linear-gradient(160deg, #15100a 0%, #070604 60%)" }}>
      <ChevronGlow tone={GOLD} />
      <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full blur-3xl" style={{ background: GOLD, opacity: 0.16 }} />
      {children}
    </div>
  )
}

const Pro = () => <span className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-black">PRO</span>

function Brand({ pro }: { pro: boolean }) {
  return (
    <div className="relative flex items-center gap-2">
      <div className="flex size-7 items-center justify-center rounded-md" style={{ background: GOLD }}>
        <TrendingUp className="size-4 text-black" aria-hidden />
      </div>
      <span className="text-base font-bold tracking-tight">TradeLoop</span>
      {pro && <Pro />}
    </div>
  )
}

// Who made it: their photo (or their initials in its place, while their name is on the card too) and their name.
function Trader({ data, photo, badge }: { data: PnlCardData; photo: boolean; badge: boolean }) {
  const { name } = data.trader
  // a photo its host will not let be drawn into an image gives way to the initials, in the preview as in the download
  const [failed, setFailed] = useState<string | null>(null)
  const image = data.trader.image && data.trader.image !== failed ? data.trader.image : null
  if (!name && !photo) return null
  return (
    <div className="relative flex min-w-0 items-center gap-2.5">
      {photo && (
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-white/25 to-white/5 text-xs font-bold ring-1 ring-white/10">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" crossOrigin="anonymous" onError={() => setFailed(image)} className="size-full object-cover" />
          ) : name ? (
            initials(name)
          ) : (
            <svg viewBox="0 0 24 24" className="size-5 text-white/70" fill="currentColor" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1-5 4.5-7 8-7s7 2 8 7z" />
            </svg>
          )}
        </div>
      )}
      {name && <span className="truncate text-sm font-semibold text-white">{name}</span>}
      {badge && <Pro />}
    </div>
  )
}

function Chips({ data }: { data: PnlCardData }) {
  const t = useT()
  if (!data.period && data.accountCount == null) return null
  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {data.period && (
        <>
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase" style={{ background: `${GOLD}26`, color: GOLD }}>
            <BadgeCheck className="size-3" aria-hidden /> {t(PERIOD_PNL[data.period.key].kind)}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">{data.period.label}</span>
        </>
      )}
      {data.accountCount != null && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">{data.accountCount === 1 ? t("1 account") : t("{n} accounts", { n: data.accountCount })}</span>}
    </div>
  )
}

function Figure({ data, size }: { data: PnlCardData; size: string }) {
  const t = useT()
  if (data.profit == null) return null
  const win = data.profit >= 0
  const tone = win ? "var(--gain)" : "var(--loss)"
  return (
    <div className="relative">
      <p className="text-[11px] font-medium tracking-wide text-white/40 uppercase">{t(data.period ? PERIOD_PNL[data.period.key].label : "P&L")}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={cn("font-extrabold tabular-nums", size)} style={{ color: tone }}>
          {win ? "+" : "-"}
          {formatCurrency(Math.abs(data.profit), data.currency)}
        </span>
        <span style={{ color: tone }}>
          <Triangle up={win} />
        </span>
      </div>
    </div>
  )
}

// What can be switched on beside the P&L: the balance, and the figures of the trades behind it.
function Extras({ data, columns }: { data: PnlCardData; columns: string }) {
  const t = useT()
  const money = (n: number) => signedMoney(n, data.currency)
  const tone = (n: number) => (n > 0 ? "var(--gain)" : n < 0 ? "var(--loss)" : undefined)
  const out: { label: string; value: string; color?: string }[] = []
  if (data.balance != null) out.push({ label: "Total balance", value: formatCurrency(data.balance, data.currency) })
  if (data.stats.winRate != null) out.push({ label: "Win rate", value: `${data.stats.winRate}%` })
  if (data.stats.trades != null) out.push({ label: "Trades", value: String(data.stats.trades) })
  if (data.stats.averageTrade != null) out.push({ label: "Average trade", value: money(data.stats.averageTrade), color: tone(data.stats.averageTrade) })
  if (data.stats.bestTrade != null) out.push({ label: "Best trade", value: money(data.stats.bestTrade), color: tone(data.stats.bestTrade) })
  if (data.stats.worstTrade != null) out.push({ label: "Worst trade", value: money(data.stats.worstTrade), color: tone(data.stats.worstTrade) })
  if (!out.length) return null
  return (
    <div className={cn("relative grid gap-x-4 gap-y-2.5", columns)}>
      {out.map((x) => (
        <div key={x.label} className="min-w-0">
          <p className={small}>{t(x.label)}</p>
          <p className="mt-0.5 truncate text-sm font-bold tabular-nums" style={{ color: x.color }}>
            {x.value}
          </p>
        </div>
      ))}
    </div>
  )
}

// Where the result came from (certificateRows in the model says how it is told), each with its broker's mark.
function Breakdown({ data, max, className }: { data: PnlCardData; max: number; className?: string }) {
  const t = useT()
  if (!data.accounts.length) return null
  const all = certificateRows(data.accounts).map((row) => ({ ...row, logo: brokerLogo(row.broker) }))
  const rows = all.slice(0, max)
  return (
    <div className={cn("relative", className)}>
      <p className={small}>{data.accounts.length > 1 ? t("Combined across accounts") : t("Account")}</p>
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              {row.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.logo} alt="" className="size-5 shrink-0 rounded-full bg-white object-cover" />
              ) : (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white" style={{ background: chipColor(row.name) }}>
                  {initials(row.name)}
                </span>
              )}
              <span className="truncate font-semibold tracking-wide text-white/80 uppercase">{row.name}</span>
            </div>
            {row.pnl != null && (
              <span className={cn("shrink-0 font-bold tabular-nums", row.pnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
                {row.pnl >= 0 ? "+" : ""}
                {formatCurrency(row.pnl, data.currency)}
              </span>
            )}
          </div>
        ))}
        {all.length > rows.length && <p className="text-[10px] text-white/35">+ {all.length - rows.length} more</p>}
      </div>
    </div>
  )
}

const Qr = ({ url, size = 52 }: { url: string; size?: number }) => (
  <div className="shrink-0 rounded-lg bg-white p-1.5">
    <QRCodeSVG value={url} size={size} />
  </div>
)

export const CERTIFICATE_WIDTH: Record<PnlCardLayout, number> = { desktop: 720, mobile: 400, "pnl-only": 640 }

// `data` has been through redactCard; `v` is what is switched on in this layout.
export function CertificateCard({ data, layout, v, shareUrl }: { data: PnlCardData; layout: PnlCardLayout; v: PnlCardVisibility; shareUrl: string | null }) {
  const qr = v.qrCode && shareUrl ? shareUrl : null
  const date = data.exportedAt ? exportDate(data.exportedAt) : null
  // the PRO mark goes with the trader: beside the logo when that is there, beside their name when it is not
  const pro = data.trader.pro
  const foot = (
    <div className="relative mt-5 flex items-end justify-between gap-3">
      <p className="text-[10px] text-white/35">{date}</p>
      {qr && <Qr url={qr} />}
    </div>
  )

  if (layout === "pnl-only") {
    return (
      <Frame width={CERTIFICATE_WIDTH[layout]}>
        <div className="relative flex items-center justify-between gap-3">
          {v.tradeLoopLogo ? <Brand pro={pro} /> : <span />}
          <Chips data={data} />
        </div>
        <div className="mt-6">
          <Figure data={data} size="text-6xl" />
        </div>
        <div className="relative mt-6 flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <Trader data={data} photo={v.traderPhoto} badge={pro && !v.tradeLoopLogo} />
            {date && <p className="text-[10px] text-white/35">{date}</p>}
          </div>
          {qr && <Qr url={qr} />}
        </div>
      </Frame>
    )
  }

  if (layout === "desktop") {
    const left = data.profit != null || !!data.period || data.accountCount != null || !!data.trader.name || v.traderPhoto
    return (
      <Frame width={CERTIFICATE_WIDTH[layout]}>
        {v.tradeLoopLogo && <Brand pro={pro} />}
        <div className={cn("relative grid gap-8", v.tradeLoopLogo && "mt-5", data.accounts.length > 0 && left ? "grid-cols-[minmax(0,1fr)_minmax(0,17rem)]" : "grid-cols-1")}>
          <div className="min-w-0 space-y-4">
            <Trader data={data} photo={v.traderPhoto} badge={pro && !v.tradeLoopLogo} />
            <Chips data={data} />
            <Figure data={data} size="text-5xl" />
            <Extras data={data} columns="grid-cols-3" />
          </div>
          <Breakdown data={data} max={8} className={cn(left && "border-s border-white/10 ps-8")} />
        </div>
        {foot}
      </Frame>
    )
  }

  // portrait: the certificate as it has always been
  return (
    <Frame width={CERTIFICATE_WIDTH[layout]}>
      {v.tradeLoopLogo && <Brand pro={pro} />}
      <div className={cn(v.tradeLoopLogo && "mt-5")}>
        <Trader data={data} photo={v.traderPhoto} badge={pro && !v.tradeLoopLogo} />
      </div>
      <div className="mt-3">
        <Chips data={data} />
      </div>
      {data.profit != null && (
        <div className="mt-5">
          <Figure data={data} size="text-4xl" />
        </div>
      )}
      <div className="mt-4">
        <Extras data={data} columns="grid-cols-2" />
      </div>
      <Breakdown data={data} max={8} className="mt-5 border-t border-white/10 pt-4" />
      {foot}
    </Frame>
  )
}
