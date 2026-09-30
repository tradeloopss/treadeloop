"use client"

import Link from "next/link"
import { Check, Lock, ArrowRight, ShieldCheck, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { BrandMark } from "@/components/brand-mark"
import { PrizeCode } from "@/components/cases/prize-code"
import { TONE_ACCENT, type CaseClaim } from "@/components/cases/types"

const isGrant = (type?: string) => type === "free_subscription" || type === "free_month"

// The "Claimed" card — styled like the case itself: dark gunmetal panel, a
// glowing purple LED strip along the top, corner bolts and the TradeLoop badge.
// Always dark (it's the crate's theme), whatever the page theme is.
//  - discount: the code, locked to the claimer's account, with a CTA to use it
//  - free subscription: no code — it's already active; shows until when
export function ClaimedCard({ claim, onClose, className }: { claim: CaseClaim; onClose?: () => void; className?: string }) {
  const t = useT()
  const reward = claim.reward
  const tone = reward?.tone ?? "common"
  const granted = isGrant(reward?.type)
  const planName = reward?.subscriptionPlan === "pro" ? "TradeLoop Pro" : "TradeLoop Essential"
  const activeUntil = (() => {
    const d = new Date(claim.claimedAt)
    d.setMonth(d.getMonth() + (reward?.subscriptionMonths ?? 1))
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
  })()
  const usable = claim.status === "active"

  return (
    <div
      className={cn(
        "dark relative w-full max-w-md overflow-hidden rounded-2xl border border-violet-400/25 bg-[linear-gradient(180deg,#191b3a_0%,#10112a_45%,#0a0b1a_100%)] text-left text-white shadow-[0_30px_90px_-25px_rgba(124,58,237,0.6)]",
        className,
      )}
    >
      {/* LED strip + corner bolts, as on the case */}
      <div className="pointer-events-none absolute inset-x-10 top-0 h-[3px] rounded-b-full bg-violet-300 shadow-[0_0_20px_5px_rgba(167,139,250,0.55)]" />
      {["left-3 top-3", "right-3 top-3", "left-3 bottom-3", "right-3 bottom-3"].map((p) => (
        <span key={p} className={cn("pointer-events-none absolute size-1.5 rounded-full bg-slate-400/40 shadow-inner", p)} />
      ))}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={t("Close")} className="absolute end-3 top-4 flex size-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/10 hover:text-white">
          <X className="size-4" />
        </button>
      )}

      <div className="px-6 pb-6 pt-7 sm:px-7">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-white/50 uppercase">
          <BrandMark className="size-5" alt="" /> {t("TradeLoop Cases Drop")}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_24px_-4px_rgba(52,211,153,0.6)]">
            <Check className="size-5" strokeWidth={2.6} />
          </span>
          <div>
            <p className="text-xl font-extrabold tracking-[0.22em] uppercase">{t("Claimed")}</p>
            <p className="text-xs text-white/50">{new Date(claim.claimedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
          </div>
        </div>

        <p className={cn("mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl", TONE_ACCENT[tone])}>{reward?.label ?? t("Reward")}</p>

        <div className="my-5 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        {granted ? (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <ShieldCheck className="size-4" /> {t("Activated on your account")}
            </p>
            <p className="text-sm leading-relaxed text-white/65">{t("{plan} is active until {date}. No code needed — it's already applied.", { plan: planName, date: activeUntil })}</p>
            <Link href="/dashboard" onClick={onClose} className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-neutral-900 transition-opacity hover:opacity-90">
              {t("Go to dashboard")} <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <PrizeCode code={claim.prizeCode} expiresAt={claim.expiresAt} status={claim.status} />
            </div>
            <p className="flex gap-2 text-xs leading-relaxed text-white/55">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-violet-300" />
              {t("Locked to your account — this code only works on a checkout you start while signed in. It can't be used by anyone else.")}
            </p>
            {usable && (
              <Link href="/pricing" onClick={onClose} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-neutral-900 transition-opacity hover:opacity-90">
                {reward?.discountPercent ? t("Use my {n}% off", { n: reward.discountPercent }) : t("Use my reward")} <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The card as a centred pop-up over a dimmed backdrop.
export function ClaimedModal({ claim, onClose }: { claim: CaseClaim; onClose: () => void }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("Claimed")} onClick={onClose}>
      <div className="animate-in fade-in-0 zoom-in-95 w-full max-w-md duration-300" onClick={(e) => e.stopPropagation()}>
        <ClaimedCard claim={claim} onClose={onClose} />
      </div>
    </div>
  )
}
