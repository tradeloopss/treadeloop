"use client"

import { QRCodeSVG } from "qrcode.react"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/calc"
import { initials } from "@/lib/ui-chips"
import { BrandMark } from "@/components/brand-mark"
import { exportDate, redactCard, signedMoney, effectiveVisibility, type PnlCardData, type PnlCardLayout, type PnlCardVisibility } from "@/lib/pnl-cards/model"

// The PNL card itself: one renderer for the editor's preview, the larger
// preview, the downloaded image and the public page. It is given the card and
// what is switched on, takes everything else out first (redactCard), and draws
// only what is left: a figure that is not there cannot be drawn by accident.
//
// The colours are the card's own, not the page's: it is an image, and it looks
// the same whatever theme the person looking at it is in.

export const CARD_WIDTH: Record<PnlCardLayout, number> = { desktop: 800, mobile: 420, "pnl-only": 800 }

const INK = "#ffffff"
const DIM = "rgba(255,255,255,0.58)"
const FAINT = "rgba(255,255,255,0.38)"
const LINE = "rgba(255,255,255,0.11)"
const PANEL = "rgba(255,255,255,0.055)"
const GAIN = "#4ade80"
const LOSS = "#fb7185"
const GLOW = "#7c6cff"
const tone = (n: number | null | undefined) => (n == null || n === 0 ? INK : n > 0 ? GAIN : LOSS)

const label = "text-[10px] font-semibold tracking-[0.14em] uppercase"

// The profit as it built up, trade by trade. Real points, or no line at all.
function Curve({ points, className }: { points: number[]; className?: string }) {
  const w = 300
  const h = 100
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 8 - ((p - min) / span) * (h - 16)] as const)
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const up = points[points.length - 1] >= points[0]
  const stroke = up ? "#a5b4fc" : "#fda4af"
  const id = up ? "pnl-curve-up" : "pnl-curve-down"
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={xy[xy.length - 1][0] - 2} cy={xy[xy.length - 1][1]} r="4" fill={INK} />
    </svg>
  )
}

function Frame({ width, minHeight, children }: { width: number; minHeight: number; children: React.ReactNode }) {
  return (
    <div data-pnl-card className="relative overflow-hidden rounded-[22px] text-white" style={{ width, minHeight, background: "linear-gradient(135deg, #090818 0%, #131038 46%, #2b1f96 100%)", fontFeatureSettings: '"tnum"' }}>
      <div aria-hidden className="pointer-events-none absolute -end-24 -top-28 size-80 rounded-full blur-3xl" style={{ background: GLOW, opacity: 0.34 }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -start-20 size-72 rounded-full blur-3xl" style={{ background: "#3b82f6", opacity: 0.14 }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px]" style={{ boxShadow: `inset 0 0 0 1px ${LINE}` }} />
      <div className="relative flex h-full flex-col" style={{ minHeight }}>
        {children}
      </div>
    </div>
  )
}

function Brand({ size = "size-8", text = "text-[19px]" }: { size?: string; text?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={size} />
      <span className={cn("font-bold tracking-tight", text)}>TradeLoop</span>
    </span>
  )
}

function Trader({ data, compact }: { data: PnlCardData; compact?: boolean }) {
  const { name, image, pro } = data.trader
  // a photo with no name beside it is still a photo: shown alone
  if (!name && !image) return null
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {image && (
        <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold", compact ? "size-8" : "size-10")} style={{ background: "linear-gradient(135deg, rgba(255,255,255,.3), rgba(255,255,255,.06))", boxShadow: `0 0 0 1px ${LINE}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" crossOrigin="anonymous" className="size-full object-cover" />
        </span>
      )}
      {name && (
        <span className="min-w-0">
          <span className={cn("block truncate font-semibold", compact ? "text-[13px]" : "text-[15px]")}>{name}</span>
          {pro && (
            <span className="block text-[11px] font-medium" style={{ color: "#a5b4fc" }}>
              Pro trader
            </span>
          )}
        </span>
      )}
    </span>
  )
}

// The trader's place when their photo is on and they have none. Their initials while their name is on
// the card too; a plain figure when it is not, so that hiding a name hides its initials with it.
function withFallbackPhoto(data: PnlCardData, wanted: boolean): PnlCardData {
  if (!wanted || data.trader.image) return data
  const inner = data.trader.name
    ? `<text x="48" y="60" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${initials(data.trader.name).replace(/[<>&]/g, "")}</text>`
    : `<circle cx="48" cy="38" r="16" fill="#fff" fill-opacity=".85"/><path d="M16 92c4-20 18-30 32-30s28 10 32 30z" fill="#fff" fill-opacity=".85"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#4f46e5"/>${inner}</svg>`
  return { ...data, trader: { ...data.trader, image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` } }
}

function Profit({ data, size }: { data: PnlCardData; size: string }) {
  if (data.profit == null) return null
  return (
    <div className="min-w-0">
      <p className={label} style={{ color: DIM }}>
        Total profit
      </p>
      <p className={cn("mt-1 leading-none font-extrabold tracking-tight", size)} style={{ color: data.profit < 0 ? LOSS : INK }}>
        {signedMoney(data.profit, data.currency)}
      </p>
    </div>
  )
}

type Tile = { label: string; value: string; color?: string }
function tiles(data: PnlCardData): Tile[] {
  const out: Tile[] = []
  const money = (n: number) => signedMoney(n, data.currency)
  if (data.balance != null) out.push({ label: "Total balance", value: formatCurrency(data.balance, data.currency) })
  if (data.accountCount != null) out.push({ label: "Total accounts", value: String(data.accountCount) })
  if (data.stats.winRate != null) out.push({ label: "Win rate", value: `${data.stats.winRate}%` })
  if (data.stats.trades != null) out.push({ label: "Trades", value: String(data.stats.trades) })
  if (data.stats.averageTrade != null) out.push({ label: "Average trade", value: money(data.stats.averageTrade), color: tone(data.stats.averageTrade) })
  if (data.stats.bestTrade != null) out.push({ label: "Best trade", value: money(data.stats.bestTrade), color: tone(data.stats.bestTrade) })
  if (data.stats.worstTrade != null) out.push({ label: "Worst trade", value: money(data.stats.worstTrade), color: tone(data.stats.worstTrade) })
  return out
}

function Accounts({ data, max, stacked }: { data: PnlCardData; max: number; stacked?: boolean }) {
  if (!data.accounts.length) return null
  const rows = data.accounts.slice(0, max)
  const more = data.accounts.length - rows.length
  const names = data.accounts.some((a) => a.label != null)
  const balances = data.accounts.some((a) => a.balance != null)
  const pnls = data.accounts.some((a) => a.pnl != null)
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: PANEL, boxShadow: `inset 0 0 0 1px ${LINE}` }}>
      <div className={cn("flex items-center gap-3 pb-2", label)} style={{ color: FAINT }}>
        <span className="min-w-0 flex-1">{names ? "Accounts" : "Account"}</span>
        {balances && !stacked && <span className="w-28 text-end">Balance</span>}
        {pnls && <span className="w-24 text-end">P&amp;L</span>}
      </div>
      {rows.map((a, i) => (
        <div key={i} className="flex items-center gap-3 py-[7px] text-[13px]" style={{ borderTop: `1px solid ${LINE}` }}>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{a.label ?? `Account ${i + 1}`}</span>
            {stacked && a.balance != null && (
              <span className="block text-[11px]" style={{ color: DIM }}>
                {formatCurrency(a.balance, data.currency)}
              </span>
            )}
          </span>
          {balances && !stacked && <span className="w-28 text-end font-medium">{a.balance != null ? formatCurrency(a.balance, data.currency) : "—"}</span>}
          {pnls && (
            <span className="w-24 text-end font-bold" style={{ color: tone(a.pnl) }}>
              {a.pnl != null ? signedMoney(a.pnl, data.currency) : "—"}
            </span>
          )}
        </div>
      ))}
      {more > 0 && (
        <p className="pt-2 text-[11px]" style={{ color: FAINT, borderTop: `1px solid ${LINE}` }}>
          + {more} more {more === 1 ? "account" : "accounts"}
        </p>
      )}
    </div>
  )
}

function Qr({ url, size }: { url: string; size: number }) {
  return (
    <span className="flex shrink-0 rounded-lg bg-white p-1.5">
      <QRCodeSVG value={url} size={size} />
    </span>
  )
}

export function PnlCard({ data: full, layout, visibility, shareUrl }: { data: PnlCardData; layout: PnlCardLayout; visibility: PnlCardVisibility; shareUrl: string | null }) {
  const v = effectiveVisibility(visibility, layout)
  const data = withFallbackPhoto(redactCard(full, visibility, layout), v.traderPhoto)
  const qr = v.qrCode && shareUrl ? shareUrl : null
  const stats = tiles(data)
  const date = data.exportedAt ? exportDate(data.exportedAt) : null

  if (layout === "pnl-only") {
    return (
      <Frame width={CARD_WIDTH[layout]} minHeight={300}>
        <div className="flex flex-1 flex-col justify-between p-8">
          <div className="flex items-start justify-between gap-4">
            {v.tradeLoopLogo ? <Brand /> : <span />}
            {data.period && (
              <span className="text-[12px] font-medium" style={{ color: DIM }}>
                {data.period.label}
              </span>
            )}
          </div>
          <div className="flex items-end justify-between gap-6 py-6">
            <Profit data={data} size="text-[68px]" />
            {data.curve && <Curve points={data.curve} className="h-24 min-w-0 flex-1" />}
          </div>
          <div className="flex items-end justify-between gap-4">
            <span className="flex min-w-0 items-center gap-4">
              <Trader data={data} />
              {date && (
                <span className="text-[12px]" style={{ color: DIM }}>
                  {date}
                </span>
              )}
            </span>
            {qr && <Qr url={qr} size={54} />}
          </div>
        </div>
      </Frame>
    )
  }

  if (layout === "mobile") {
    return (
      <Frame width={CARD_WIDTH[layout]} minHeight={620}>
        <div className="flex flex-1 flex-col gap-5 p-6">
          <div className="flex items-center justify-between gap-3">
            {v.tradeLoopLogo ? <Brand size="size-7" text="text-[17px]" /> : <span />}
            {date && (
              <span className="text-[11px] font-medium" style={{ color: DIM }}>
                {date}
              </span>
            )}
          </div>
          <Trader data={data} />
          {data.profit != null && (
            <div>
              <Profit data={data} size="text-[46px]" />
              {data.curve && <Curve points={data.curve} className="mt-3 h-20 w-full" />}
            </div>
          )}
          {stats.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              {stats.map((t) => (
                <div key={t.label}>
                  <p className={label} style={{ color: DIM }}>
                    {t.label}
                  </p>
                  <p className="mt-0.5 text-[19px] font-bold" style={{ color: t.color ?? INK }}>
                    {t.value}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Accounts data={data} max={6} stacked />
          <div className="mt-auto flex items-end justify-between gap-4 pt-1">
            <span className="min-w-0 text-[11px]" style={{ color: DIM }}>
              {data.period && <span className="block">{data.period.label}</span>}
              {v.tradeLoopLogo && <span className="block">tradeloop.pro</span>}
            </span>
            {qr && <Qr url={qr} size={58} />}
          </div>
        </div>
      </Frame>
    )
  }

  return (
    <Frame width={CARD_WIDTH[layout]} minHeight={450}>
      <div className="flex flex-1 flex-col gap-5 p-8">
        <div className="flex items-center justify-between gap-4">
          {v.tradeLoopLogo ? <Brand /> : <span />}
          {date && (
            <span className="text-[12px] font-medium" style={{ color: DIM }}>
              {date}
            </span>
          )}
        </div>
        <Trader data={data} />
        {(data.profit != null || stats.length > 0) && (
          <div className="flex items-end gap-6">
            <div className="min-w-0 shrink-0">
              <Profit data={data} size="text-[52px]" />
              {stats.length > 0 && (
                <div className={cn("flex max-w-[460px] flex-wrap gap-x-7 gap-y-3", data.profit != null && "mt-5")}>
                  {stats.map((t) => (
                    <div key={t.label}>
                      <p className={label} style={{ color: DIM }}>
                        {t.label}
                      </p>
                      <p className="mt-0.5 text-[20px] font-bold" style={{ color: t.color ?? INK }}>
                        {t.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {data.curve && <Curve points={data.curve} className="h-28 min-w-0 flex-1" />}
          </div>
        )}
        <Accounts data={data} max={5} />
        <div className="mt-auto flex items-end justify-between gap-4">
          <span className="min-w-0 text-[12px]" style={{ color: DIM }}>
            {data.period && <span className="block">{data.period.label}</span>}
            {v.tradeLoopLogo && <span className="block">tradeloop.pro</span>}
          </span>
          {qr && <Qr url={qr} size={62} />}
        </div>
      </div>
    </Frame>
  )
}
