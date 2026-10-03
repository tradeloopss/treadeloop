"use client"

import { useRef, useState } from "react"
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { AtSign, Camera, Copy, Download, Link2, Mail, MessageCircle, QrCode, Send, Share2, ThumbsUp } from "lucide-react"
import { copyText } from "./referral-link"
import { useShareLink } from "./header-tools"
import { btnClass, ghostBtnClass } from "./ui"
import { cn } from "@/lib/utils"

// Everything for sharing the referral link: the share sheets of each network,
// a QR code, and ready-made messages.

const enc = encodeURIComponent

export function ShareCenter({ url, coupon }: { url: string; coupon: { code: string; percent: number } | null }) {
  const share = useShareLink(url)
  const canvas = useRef<HTMLDivElement>(null)
  const templates = [
    `I'm using TradeLoop to journal and analyze my trades. Try it here → ${url}`,
    `If you trade futures or forex, TradeLoop syncs your trades automatically and shows you exactly where you make and lose money. ${url}`,
    `My trading got more consistent once I started reviewing every trade in TradeLoop. Check it out: ${url}`,
    ...(coupon ? [`Use my code ${coupon.code} for ${coupon.percent}% off TradeLoop — the trading journal I use every day: ${url}`] : []),
  ]
  const [pick, setPick] = useState(0)
  const message = templates[pick]
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer")
  const targets: { key: string; label: string; icon: React.ElementType; tint: string; run: () => void }[] = [
    { key: "copy", label: "Copy link", icon: Link2, tint: "from-[#7c3aed] to-[#2563eb]", run: () => copyText(url, "Referral link copied!") },
    {
      key: "instagram",
      label: "Instagram",
      icon: Camera,
      tint: "from-[#f58529] via-[#dd2a7b] to-[#8134af]",
      run: async () => {
        // Instagram has no web share link: copy the message, then open the app.
        if (await copyText(message, "Message copied — paste it into your story or bio.")) open("https://www.instagram.com/")
      },
    },
    { key: "x", label: "X (Twitter)", icon: AtSign, tint: "from-[#111] to-[#444]", run: () => open(`https://twitter.com/intent/tweet?text=${enc(message)}`) },
    { key: "facebook", label: "Facebook", icon: ThumbsUp, tint: "from-[#1877f2] to-[#0b5ed7]", run: () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`) },
    { key: "telegram", label: "Telegram", icon: Send, tint: "from-[#2aabee] to-[#229ed9]", run: () => open(`https://t.me/share/url?url=${enc(url)}&text=${enc(message.replace(url, "").trim())}`) },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, tint: "from-[#25d366] to-[#128c7e]", run: () => open(`https://wa.me/?text=${enc(message)}`) },
    { key: "email", label: "Email", icon: Mail, tint: "from-[#06b6d4] to-[#2563eb]", run: () => (window.location.href = `mailto:?subject=${enc("Try TradeLoop")}&body=${enc(message)}`) },
  ]
  const downloadQr = () => {
    const c = canvas.current?.querySelector("canvas")
    if (!c) return
    const a = document.createElement("a")
    a.href = c.toDataURL("image/png")
    a.download = "tradeloop-referral-qr.png"
    a.click()
    toast.success("QR code saved.")
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
      <section className="v2-card-glow p-5 sm:p-6 lg:col-span-2">
        <h2 className="text-[15px] font-semibold">Share TradeLoop</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Choose how you want to share your referral link.</p>
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {targets.map((t) => (
            <li key={t.key}>
              <button type="button" onClick={t.run} className="group flex w-full flex-col items-center gap-2 rounded-xl p-2 text-center focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                <span className={cn("flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_8px_20px_-10px_rgb(0_0_0/0.6)] transition-transform group-hover:-translate-y-0.5", t.tint)}>
                  <t.icon className="size-5" aria-hidden />
                </span>
                <span className="text-[11px] leading-tight font-medium">{t.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-5 rounded-xl border bg-background/40 px-3 py-2.5">
          <p className="truncate font-mono text-[13px]" title={url}>
            {url}
          </p>
        </div>

        <h3 className="mt-6 text-sm font-semibold">Ready-made messages</h3>
        <div role="radiogroup" aria-label="Message" className="mt-2 flex flex-col gap-2">
          {templates.map((t, i) => (
            <button key={i} type="button" role="radio" aria-checked={pick === i} onClick={() => setPick(i)} className={cn("rounded-xl border px-3 py-2.5 text-start text-sm leading-relaxed transition-colors", pick === i ? "border-primary bg-primary/[0.07]" : "hover:bg-muted/40")}>
              {t}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => copyText(message, "Message copied!")} className={ghostBtnClass}>
            <Copy className="size-4" aria-hidden /> Copy Message
          </button>
          <button
            type="button"
            onClick={async () => {
              if (navigator.share) {
                try {
                  await navigator.share({ text: message })
                  return
                } catch (e) {
                  if ((e as Error)?.name === "AbortError") return
                }
              }
              copyText(message, "Message copied!")
            }}
            className={btnClass}
          >
            <Share2 className="size-4" aria-hidden /> Share
          </button>
        </div>
      </section>

      <section className="v2-card flex flex-col items-center p-5 text-center sm:p-6">
        <p className="flex items-center gap-1.5 text-[15px] font-semibold">
          <QrCode className="size-4 text-primary" aria-hidden /> QR code
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">For slides, flyers, streams and videos.</p>
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_0_40px_-16px_rgb(139_92_246/0.8)]">
          <QRCodeSVG value={url} size={180} level="M" fgColor="#0b1533" bgColor="#ffffff" title="Your referral link as a QR code" />
        </div>
        <div ref={canvas} className="hidden" aria-hidden>
          <QRCodeCanvas value={url} size={720} level="M" marginSize={2} fgColor="#0b1533" bgColor="#ffffff" />
        </div>
        <button type="button" onClick={downloadQr} className={cn(ghostBtnClass, "mt-4")}>
          <Download className="size-4" aria-hidden /> Download PNG
        </button>
        <button type="button" onClick={() => share()} className={cn(btnClass, "mt-2 w-full")}>
          <Share2 className="size-4" aria-hidden /> Share link
        </button>
        {coupon && (
          <p className="mt-4 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Your code <span className="font-mono font-semibold text-foreground">{coupon.code}</span> gives {coupon.percent}% off.
          </p>
        )}
      </section>
    </div>
  )
}
