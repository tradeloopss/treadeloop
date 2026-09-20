"use client"

import { useEffect, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { toPng } from "html-to-image"
import { sharePayout } from "@/app/actions/payouts"
import type { PayoutSummary } from "@/lib/payout-period"
import { formatCurrency } from "@/lib/calc"
import { chipColor, initials } from "@/lib/ui-chips"
import { Button } from "@/components/ui/button"
import { FitToWidth } from "@/components/fit-to-width"
import { BadgeCheck, Copy, Download, Loader2, Printer, Share2 } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

// Cascading chevrons — an original geometric pattern in the "tech glow" idiom
// of trading share cards, not a copied logo or asset. Kept recessive so the
// QR code and figures stay readable on top of it.
function ArrowGlow({ tone }: { tone: string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 end-0 w-[52%] overflow-hidden">
      <div
        className="absolute -end-10 top-1/2 size-[340px] -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: `${tone}1f` }}
      />
      <svg className="absolute inset-0 size-full" viewBox="0 0 300 260" fill="none" preserveAspectRatio="xMidYMid meet">
        <g stroke={tone} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
          {[0, 46, 92, 138].map((offset, i) => (
            <path key={offset} d={`M ${96 + offset} 34 L ${176 + offset} 126 L ${96 + offset} 218`} opacity={1 - i * 0.2} />
          ))}
        </g>
      </svg>
    </div>
  )
}

export function PayoutCertificate({
  summary,
  isPro,
  shareUrl: fixedShareUrl,
}: {
  summary: PayoutSummary
  isPro?: boolean
  /** Set on the public /p/<token> page, where the link already exists. */
  shareUrl?: string | null
}) {
  const t = useT()
  const [downloading, setDownloading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const tone = "#22c55e"
  const payoutCount = summary.lines.reduce((sum, l) => sum + l.count, 0)
  const avgPerAccount = summary.accountCount > 0 ? summary.total / summary.accountCount : 0
  const largest = summary.lines.reduce((max, l) => Math.max(max, l.amount), 0)

  // The QR code is part of the certificate, so its link is minted as soon as
  // the card renders. A link belongs to one payout window, so switching
  // Monthly/Bi-weekly mints a fresh one rather than pointing the QR at the
  // wrong period. Nothing is exposed until the trader hands out the link or
  // the image — the token is unguessable and never listed anywhere.
  useEffect(() => {
    if (fixedShareUrl) return
    let cancelled = false
    setToken(null)
    setLinking(true)
    sharePayout(summary.period)
      .then((t) => {
        if (!cancelled) setToken(t)
      })
      .catch(() => {
        if (!cancelled) toast.error(t("Could not create the certificate's share link"))
      })
      .finally(() => {
        if (!cancelled) setLinking(false)
      })
    return () => {
      cancelled = true
    }
  }, [fixedShareUrl, summary.period, summary.start])

  const shareUrl =
    fixedShareUrl ?? (token && typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : null)

  function onCopyLink() {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(
      () => toast.success(t("Link copied")),
      () => toast.error(t("Could not copy link"))
    )
  }

  async function onShare() {
    if (!shareUrl) return
    if (navigator.share) {
      try {
        await navigator.share({ title: t("Payouts — {period}", { period: summary.periodLabel }), url: shareUrl })
      } catch {
        // user cancelled — nothing to do
      }
    } else {
      onCopyLink()
    }
  }

  async function onDownload() {
    if (!cardRef.current) return
    setDownloading(true)
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2 })
      const link = document.createElement("a")
      link.download = `tradeloop-payout-${summary.periodLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`
      link.href = dataUrl
      link.click()
    } catch {
      toast.error(t("Could not generate the certificate image"))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <FitToWidth width={720}>
        <div ref={cardRef}>
          <div
            id="payout-certificate"
            className="relative w-[720px] overflow-hidden rounded-[24px] text-white shadow-2xl ring-1 ring-white/10"
            style={{ background: "radial-gradient(120% 120% at 80% 30%, #06140c 0%, #050706 45%, #030403 100%)" }}
          >
            <ArrowGlow tone={tone} />

            <div className="relative flex items-stretch">
              <div className="min-w-0 flex-1 p-7">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 16 16" className="size-4" fill={tone}>
                    <path d="M8 2 L14 13 L2 13 Z" />
                  </svg>
                  <span className="text-[17px] font-bold tracking-tight">TradeLoop</span>
                </div>

                <div className="mt-5 flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-white/25 to-white/5 text-xs font-bold ring-1 ring-white/10">
                    {summary.traderImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={summary.traderImage} alt="" className="size-full object-cover" />
                    ) : (
                      initials(summary.traderName)
                    )}
                  </div>
                  <span className="truncate text-[15px] font-semibold">{summary.traderName}</span>
                  {isPro && (
                    <span className="shrink-0 rounded-md bg-gradient-to-b from-amber-300 to-amber-400 px-2 py-0.5 text-[11px] font-bold text-black">
                      PRO
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold"
                    style={{ borderColor: `${tone}40`, color: tone }}
                  >
                    <BadgeCheck className="size-3.5" />
                    {t("PAYOUT")}
                  </span>
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-white/70">
                    {summary.period === "monthly" ? t("MONTHLY") : t("BI-WEEKLY")}
                  </span>
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-white/70">
                    {summary.periodLabel}
                  </span>
                </div>

                <p className="mt-6 text-[13px] font-medium text-white/50">{t("Total Payouts")}</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span
                    className="text-[44px] font-extrabold tabular-nums leading-none"
                    style={{ color: tone, textShadow: `0 0 28px ${tone}80, 0 0 6px ${tone}66` }}
                  >
                    {formatCurrency(summary.total, summary.currency)}
                  </span>
                  <span className="text-[15px] font-semibold" style={{ color: tone }}>
                    {payoutCount === 1 ? t("1 payout") : t("{n} payouts", { n: payoutCount })}
                  </span>
                </div>

                <div className="mt-7 grid grid-cols-3 gap-4 border-t border-white/[0.07] pt-4">
                  <div>
                    <p className="text-[11px] text-white/40">{t("Accounts Paid")}</p>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{summary.accountCount}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-white/40">{t("Avg per Account")}</p>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums">
                      {formatCurrency(avgPerAccount, summary.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-white/40">{t("Largest Payout")}</p>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums" style={{ color: tone }}>
                      {formatCurrency(largest, summary.currency)}
                    </p>
                  </div>
                </div>

                {summary.lines.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {summary.lines.slice(0, 3).map((line) => {
                      const name = line.firmName ?? line.accountName
                      return (
                        <span
                          key={line.accountId}
                          className="flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.06] py-1 ps-1 pe-2.5 text-[11px]"
                        >
                          <span
                            className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white"
                            style={{ background: chipColor(name) }}
                          >
                            {initials(name)}
                          </span>
                          <span className="truncate font-semibold text-white/80">{name}</span>
                          <span className="shrink-0 font-bold tabular-nums" style={{ color: tone }}>
                            {formatCurrency(line.amount, summary.currency)}
                          </span>
                        </span>
                      )
                    })}
                    {summary.lines.length > 3 && (
                      <span className="flex items-center rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/60">
                        {t("+{n} more", { n: summary.lines.length - 3 })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="relative flex w-[38%] shrink-0 items-end justify-center p-7">
                <div className="rounded-2xl bg-white p-2.5 shadow-lg">
                  {shareUrl ? (
                    <QRCodeSVG value={shareUrl} size={104} />
                  ) : (
                    // Link still being minted — a blank tile of the same size so
                    // the card doesn't reflow, never a placeholder that looks
                    // like a scannable code.
                    <div className="flex size-[104px] items-center justify-center text-black/25">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </FitToWidth>

      <div className="mx-auto w-full max-w-[720px] space-y-2">
        {!fixedShareUrl && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCopyLink} disabled={!shareUrl}>
              <Copy className="size-4" /> {linking ? t("Preparing link…") : t("Copy link")}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onShare} disabled={!shareUrl}>
              <Share2 className="size-4" /> {t("Share")}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onDownload} disabled={downloading}>
            <Download className="size-4" /> {downloading ? t("Saving…") : t("Download PNG")}
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={() => window.print()}>
            <Printer className="size-4" /> {t("Print")}
          </Button>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payout-certificate, #payout-certificate * { visibility: visible; }
          #payout-certificate { position: fixed; inset: 0; margin: auto; }
        }
      `}</style>
    </div>
  )
}
