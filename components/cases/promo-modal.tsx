"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { X, Gift, ArrowRight, Flame } from "lucide-react"
import { useT } from "@/components/locale-provider"

// A one-time-per-drop nudge shown when the user opens their dashboard while a
// Cases Drop is live and unclaimed: the promo render + "don't miss this drop",
// a live countdown, and a CTA. Clicking the image or the button opens /cases.
// Dismissal is remembered per drop per device so it doesn't nag.
export function CasesPromoModal({ dropId, endAt, remaining, totalCases }: { dropId: number; endAt: string | null; remaining: number; totalCases: number }) {
  const t = useT()
  const router = useRouter()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(`tl-cases-promo:${dropId}`) === "1"
    } catch {
      /* storage blocked */
    }
    if (dismissed) return
    const id = setTimeout(() => setShow(true), 500)
    return () => clearTimeout(id)
  }, [dropId])

  function remember() {
    try {
      localStorage.setItem(`tl-cases-promo:${dropId}`, "1")
    } catch {
      /* ignore */
    }
  }
  function dismiss() {
    remember()
    setShow(false)
  }
  function go() {
    remember()
    router.push("/cases")
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("TradeLoop Cases Drop")}>
      <div className="animate-in fade-in-0 zoom-in-95 relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a18] text-white shadow-2xl duration-200">
        <button type="button" onClick={dismiss} aria-label={t("Close")} className="absolute end-3 top-3 z-10 flex size-9 items-center justify-center rounded-lg bg-black/40 text-white/70 hover:bg-black/60 hover:text-white">
          <X className="size-4" />
        </button>

        {/* Clickable promo image */}
        <button type="button" onClick={go} className="block w-full" aria-label={t("Open the Cases Drop")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cases/case-hero.png" alt={t("TradeLoop Cases Drop")} className="w-full select-none" draggable={false} />
        </button>

        <div className="p-5 text-center sm:p-6">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-bold tracking-wider text-fuchsia-300 uppercase">
            <Flame className="size-3.5" /> {t("Limited time drop")}
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{t("Don't miss this drop!!")}</h2>
          <p className="mt-1.5 text-sm text-white/60">
            {t("Claim your FREE TradeLoop case — one per person, only {n} cases. Every case wins.", { n: totalCases })}
          </p>

          {endAt && <Countdown endAt={endAt} />}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={go}
              className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-base font-bold text-white shadow-[0_16px_40px_-12px_rgba(139,92,246,0.7)] transition-transform hover:scale-[1.02]"
            >
              <Gift className="size-5" /> {t("GET YOUR FREE CASE")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button type="button" onClick={dismiss} className="text-xs font-medium text-white/40 hover:text-white/70">
              {t("Maybe later")}
            </button>
          </div>
          <p className="mt-2 text-[11px] font-semibold text-emerald-300/80">{remaining <= 0 ? t("Sold out") : t("{n} of {total} cases still available", { n: remaining, total: totalCases })}</p>
        </div>
      </div>
    </div>
  )
}

function Countdown({ endAt }: { endAt: string }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = Math.max(0, new Date(endAt).getTime() - now)
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cells: [number, string][] = [
    [d, t("Days")],
    [h, t("Hours")],
    [m, t("Min")],
    [s, t("Sec")],
  ]
  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      {cells.map(([v, label], i) => (
        <div key={i} className="min-w-14 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
          <p className="font-mono text-xl font-bold tabular-nums">{String(v).padStart(2, "0")}</p>
          <p className="text-[10px] font-medium text-white/40 uppercase">{label}</p>
        </div>
      ))}
    </div>
  )
}
