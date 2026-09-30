"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Gift, Users, Ticket, ShieldCheck, Sparkles, Zap, ArrowRight, Loader2, X, Lock, PartyPopper, Timer, Hand } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { BrandMark } from "@/components/brand-mark"
import { Case3D, type Case3DHandle } from "@/components/cases/case-3d"
import { OpeningOverlay } from "@/components/cases/opening-overlay"
import { PrizeCode } from "@/components/cases/prize-code"
import { TONE_ACCENT, TONE_RING, type CaseClaim, type CaseDrop, type CaseReward } from "@/components/cases/types"
import { claimActiveCase } from "@/app/actions/cases"

// Surface tokens so the whole promo follows the device light/dark theme while
// keeping the neon accents on both.
const PANEL = "border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none"
const MUTED = "text-slate-500 dark:text-white/55"

export function CasesDrop({ drop, initialClaim }: { drop: CaseDrop; initialClaim: CaseClaim | null }) {
  const t = useT()
  const router = useRouter()
  const [claim, setClaim] = useState<CaseClaim | null>(initialClaim)
  const [claimedCount, setClaimedCount] = useState(drop.claimedCases)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<{ reward: CaseReward; prizeCode: string; expiresAt: string } | null>(null)
  const heroCase = useRef<Case3DHandle>(null)

  const remaining = Math.max(0, drop.totalCases - claimedCount)
  const pct = drop.totalCases > 0 ? Math.min(100, Math.round((claimedCount / drop.totalCases) * 100)) : 0
  const soldOut = remaining <= 0
  const claimed = claim != null

  async function onConfirm() {
    setClaiming(true)
    setError(null)
    const res = await claimActiveCase(drop.id)
    setClaiming(false)
    if (!res.ok) {
      setError(res.error)
      setConfirmOpen(false)
      return
    }
    setConfirmOpen(false)
    const nextClaim: CaseClaim = {
      prizeCode: res.prizeCode,
      reward: { ...res.reward, quantity: 0, probability: 0, remaining: 0 },
      claimedAt: res.claimedAt,
      expiresAt: res.expiresAt,
      redeemedAt: res.redeemedAt,
      status: res.status,
    }
    setClaim(nextClaim)
    if (res.alreadyClaimed) {
      heroCase.current?.open({ cinematic: false })
      router.refresh()
      document.getElementById("your-reward")?.scrollIntoView({ behavior: "smooth" })
      return
    }
    setClaimedCount((n) => n + 1)
    setOverlay({ reward: nextClaim.reward as CaseReward, prizeCode: res.prizeCode, expiresAt: res.expiresAt })
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-[#f6f5fc] text-slate-900 dark:bg-[#0a0a18] dark:text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.18),transparent_60%)] dark:bg-[radial-gradient(circle,rgba(124,92,255,0.22),transparent_60%)]" />
        <div className="absolute -right-40 top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,120,255,0.14),transparent_60%)] dark:bg-[radial-gradient(circle,rgba(56,120,255,0.18),transparent_60%)]" />
        <div className="absolute bottom-0 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(240,78,155,0.08),transparent_60%)]" />
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16">
        {/* Top bar */}
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-7" alt="TradeLoop" />
          <span className="font-semibold tracking-tight">TradeLoop</span>
          <span className="ms-1 rounded-md bg-black/[0.06] px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-white/70">{t("Cases Drop")}</span>
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:border-emerald-400/30 dark:text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400" /> {soldOut ? t("SOLD OUT") : t("LIVE")}
          </span>
        </div>

        {/* Hero — text left, case right on desktop; text first, case below on mobile */}
        <section className="mt-6 grid items-center gap-8 sm:mt-8 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.04] px-3 py-1 text-xs font-semibold tracking-wider text-slate-600 uppercase dark:border-white/10 dark:bg-white/5 dark:text-white/70">
              <Sparkles className="size-3.5 text-violet-500 dark:text-violet-300" /> {t("Limited drop")}
            </div>
            <h1 className="mt-4 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              {t("TRADELOOP")}{" "}
              <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-500 bg-clip-text text-transparent dark:from-violet-400 dark:via-fuchsia-400 dark:to-sky-400">{t("CASES DROP")}</span>
            </h1>
            <p className="mt-3 text-lg font-semibold text-slate-700 dark:text-white/80">{t("One case. Big rewards.")}</p>
            <p className={cn("mt-1 text-sm", MUTED)}>{t("Claim your FREE case and discover your reward.")}</p>

            {!claimed ? (
              <button
                type="button"
                onClick={() => (soldOut ? null : setConfirmOpen(true))}
                disabled={soldOut}
                className={cn(
                  "group mt-7 inline-flex h-14 items-center justify-center gap-2 rounded-2xl px-8 text-base font-bold transition-transform",
                  soldOut
                    ? "cursor-not-allowed bg-black/5 text-slate-400 dark:bg-white/10 dark:text-white/40"
                    : "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_16px_40px_-12px_rgba(139,92,246,0.7)] hover:scale-[1.03]",
                )}
              >
                {soldOut ? <><Lock className="size-4" /> {t("DROP SOLD OUT")}</> : <><Gift className="size-5" /> {t("GET YOUR FREE CASE")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => document.getElementById("your-reward")?.scrollIntoView({ behavior: "smooth" })}
                className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-black/[0.03] px-6 text-base font-semibold text-slate-800 transition-colors hover:bg-black/5 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                <PartyPopper className="size-4 text-fuchsia-500 dark:text-fuchsia-300" /> {t("View your reward")}
              </button>
            )}
            {error && <p className="mt-3 text-sm font-medium text-red-500 dark:text-red-400">{error}</p>}

            <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs font-semibold text-slate-600 lg:justify-start dark:text-white/60">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-violet-500 dark:text-violet-300" /> {t("100% FREE")}</span>
              <span className="inline-flex items-center gap-1.5"><Users className="size-4 text-violet-500 dark:text-violet-300" /> {t("1 CASE PER PERSON")}</span>
              <span className="inline-flex items-center gap-1.5"><Ticket className="size-4 text-violet-500 dark:text-violet-300" /> {t("ONLY {n} CASES", { n: drop.totalCases })}</span>
            </div>
          </div>

          {/* The 3D case — drag to rotate; tap to open (or, once claimed, to close/reopen) */}
          <div className="flex flex-col items-center">
            <Case3D
              ref={heroCase}
              className="aspect-[4/3] w-[min(92vw,580px)]"
              framing="hero"
              initial={claimed ? "open" : "closed"}
              tone={claimed && claim?.reward ? claim.reward.tone : "brand"}
              interactive
              paused={overlay != null}
              clickMode={claimed ? "toggle" : soldOut ? "none" : "activate"}
              onActivate={() => setConfirmOpen(true)}
              ariaLabel={claimed ? t("Your open TradeLoop case — press to close or reopen") : t("TradeLoop case — press to open your free case")}
            />
            <p className="-mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-white/45">
              <Hand className="size-3.5" />
              {claimed ? t("Drag to rotate · tap to close or reopen") : soldOut ? t("Drag to rotate") : t("Drag to rotate · tap to open")}
            </p>
          </div>
        </section>

        {/* Drop status */}
        <section className={cn("mt-10 rounded-2xl p-5 backdrop-blur sm:p-6", PANEL)}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">{t("{n} cases only", { n: drop.totalCases })}</p>
              <p className="mt-1 text-2xl font-bold">
                {claimedCount} <span className="text-slate-400 dark:text-white/40">/ {drop.totalCases}</span> <span className="text-base font-semibold text-slate-600 dark:text-white/60">{t("claimed")}</span>
              </p>
            </div>
            <p className={cn("text-sm font-bold", soldOut ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-300")}>{soldOut ? t("Sold out") : t("{n} remaining", { n: remaining })}</p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-400 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          {drop.endAt && <Countdown endAt={drop.endAt} />}
        </section>

        {/* Rewards */}
        <section className="mt-12">
          <h2 className="text-center text-2xl font-bold tracking-tight">{t("What can you win?")}</h2>
          <p className={cn("mt-1 text-center text-sm", MUTED)}>{t("Every case has a reward.")}</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {drop.rewards.map((r) => (
              <RewardCard key={r.id} reward={r} />
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mt-12">
          <h2 className="text-center text-2xl font-bold tracking-tight">{t("How it works")}</h2>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-5">
            {[
              { icon: Gift, label: t("Claim your case") },
              { icon: Zap, label: t("Open your case") },
              { icon: Sparkles, label: t("Reveal your reward") },
              { icon: Ticket, label: t("Use your prize code") },
              { icon: Timer, label: t("Claim within {n} days", { n: drop.prizeExpirationDays }) },
            ].map((s, i) => (
              <div key={i} className={cn("relative rounded-2xl p-4 text-center", PANEL)}>
                <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15 text-violet-600 dark:from-violet-500/30 dark:to-fuchsia-500/20 dark:text-violet-200">
                  <s.icon className="size-5" />
                </span>
                <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-white/70">{i + 1}. {s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Your reward / waiting */}
        <section id="your-reward" className="mt-12 scroll-mt-6">
          {claimed && claim ? (
            <ClaimedPanel claim={claim} />
          ) : (
            <div className={cn("rounded-2xl p-8 text-center", PANEL)}>
              <CaseBadge className="mx-auto size-16" />
              <p className="mt-4 text-lg font-bold">{soldOut ? t("This drop is sold out") : t("Your case is waiting")}</p>
              <p className={cn("mt-1 text-sm", MUTED)}>{soldOut ? t("All {n} cases have been claimed.", { n: drop.totalCases }) : t("Claim your free case and discover your reward.")}</p>
              {!soldOut && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-base font-bold text-white transition-transform hover:scale-[1.02]"
                >
                  <Gift className="size-5" /> {t("GET YOUR FREE CASE")}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Sticky mobile CTA */}
      {!claimed && !soldOut && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 p-3 backdrop-blur sm:hidden dark:border-white/10 dark:bg-[#0a0a18]/95">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-base font-bold text-white"
          >
            <Gift className="size-5" /> {t("GET YOUR FREE CASE")}
          </button>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/70" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-6 text-center text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#12121f] dark:text-white">
            <button type="button" onClick={() => setConfirmOpen(false)} aria-label={t("Close")} className="ms-auto flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-black/5 hover:text-slate-700 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white">
              <X className="size-4" />
            </button>
            <CaseBadge className="mx-auto -mt-2 size-16" />
            <h3 className="mt-3 text-xl font-bold">{t("Ready to open your case?")}</h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-white/60">{t("You can claim ONE case from this drop. Your reward will be randomly assigned.")}</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={claiming} className="h-12 flex-1 rounded-xl border border-black/10 text-sm font-semibold text-slate-700 transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/5">
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={claiming}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-70"
              >
                {claiming ? <><Loader2 className="size-4 animate-spin" /> {t("Opening…")}</> : t("Open my case")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Opening animation */}
      {overlay && (
        <OpeningOverlay
          reward={overlay.reward}
          prizeCode={overlay.prizeCode}
          expiresAt={overlay.expiresAt}
          onDone={() => {
            setOverlay(null)
            router.refresh()
            // The hero case was closed behind the overlay — pop it open to match.
            heroCase.current?.open({ cinematic: false })
            document.getElementById("your-reward")?.scrollIntoView({ behavior: "smooth" })
          }}
        />
      )}
    </div>
  )
}

const TONE_BADGE: Record<CaseReward["tone"] | "brand", string> = {
  brand: "from-violet-500 to-fuchsia-500",
  legendary: "from-amber-400 to-fuchsia-500",
  epic: "from-fuchsia-500 to-violet-600",
  rare: "from-sky-400 to-violet-500",
  common: "from-indigo-500 to-violet-500",
}

// A small glowing badge used where a full 3D case would be too much.
function CaseBadge({ tone = "brand", icon: Icon = Gift, className }: { tone?: CaseReward["tone"] | "brand"; icon?: typeof Gift; className?: string }) {
  return (
    <span className={cn("flex items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_0_40px_-6px_rgba(139,92,246,0.75)]", TONE_BADGE[tone], className)}>
      <Icon className="size-1/2" strokeWidth={2.2} />
    </span>
  )
}

function RewardCard({ reward }: { reward: CaseReward }) {
  const t = useT()
  return (
    <div className={cn("rounded-2xl p-4 ring-1 ring-inset", PANEL, TONE_RING[reward.tone])}>
      <p className={cn("text-3xl font-black", TONE_ACCENT[reward.tone])}>{reward.probability}%</p>
      <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-white/40">{t("{n} cases", { n: reward.quantity })}</p>
      <p className="mt-2 text-sm font-bold leading-snug text-slate-900 dark:text-white">{reward.label}</p>
      {reward.remaining > 0 && reward.remaining < reward.quantity && (
        <p className="mt-1 text-[11px] font-medium text-emerald-600/90 dark:text-emerald-300/80">{t("{n} remaining", { n: reward.remaining })}</p>
      )}
    </div>
  )
}

function ClaimedPanel({ claim }: { claim: CaseClaim }) {
  const t = useT()
  const tone = claim.reward?.tone ?? "common"
  return (
    <div className={cn("relative overflow-hidden rounded-2xl p-6 ring-1 ring-inset sm:p-8", PANEL, TONE_RING[tone])}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
        <CaseBadge tone={tone} icon={PartyPopper} className="size-20 shrink-0" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-slate-600 uppercase dark:text-white/60">
            <PartyPopper className={cn("size-4", TONE_ACCENT[tone])} /> {t("Your reward")}
          </p>
          <p className={cn("mt-1 text-4xl font-black tracking-tight", TONE_ACCENT[tone])}>{claim.reward?.label ?? t("Reward")}</p>
          <div className="mt-5 rounded-xl border border-black/10 bg-slate-50 p-4 dark:border-white/10 dark:bg-black/30">
            <PrizeCode code={claim.prizeCode} expiresAt={claim.expiresAt} status={claim.status} rewardType={claim.reward?.type} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Countdown({ endAt }: { endAt: string }) {
  const t = useT()
  const target = useMemo(() => new Date(endAt).getTime(), [endAt])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = Math.max(0, target - now)
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (ms <= 0) return <p className="mt-3 text-xs font-semibold text-red-500 dark:text-red-400">{t("This drop has ended.")}</p>
  return (
    <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-white/60">
      <Timer className="size-3.5 text-violet-500 dark:text-violet-300" /> {t("Ends in")}{" "}
      <span className="font-mono font-semibold text-slate-900 dark:text-white/85">{d}d {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>
    </p>
  )
}
