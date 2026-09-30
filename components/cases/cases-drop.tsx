"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Gift, Users, Ticket, ShieldCheck, Sparkles, Zap, ArrowRight, Loader2, X, Lock, PartyPopper, Timer } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { BrandMark } from "@/components/brand-mark"
import { CaseVisual } from "@/components/cases/case-visual"
import { OpeningOverlay } from "@/components/cases/opening-overlay"
import { PrizeCode } from "@/components/cases/prize-code"
import { TONE_ACCENT, TONE_RING, type CaseClaim, type CaseDrop, type CaseReward } from "@/components/cases/types"
import { claimActiveCase } from "@/app/actions/cases"

export function CasesDrop({ drop, initialClaim }: { drop: CaseDrop; initialClaim: CaseClaim | null }) {
  const t = useT()
  const router = useRouter()
  const [claim, setClaim] = useState<CaseClaim | null>(initialClaim)
  const [claimedCount, setClaimedCount] = useState(drop.claimedCases)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<{ reward: CaseReward; prizeCode: string; expiresAt: string } | null>(null)

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
      // Already had a prize — just reveal it without re-animating.
      router.refresh()
      document.getElementById("your-reward")?.scrollIntoView({ behavior: "smooth" })
      return
    }
    setClaimedCount((n) => n + 1)
    setOverlay({ reward: nextClaim.reward as CaseReward, prizeCode: res.prizeCode, expiresAt: res.expiresAt })
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-[#0a0a18] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.22),transparent_60%)]" />
        <div className="absolute -right-40 top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,120,255,0.18),transparent_60%)]" />
        <div className="absolute bottom-0 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(240,78,155,0.10),transparent_60%)]" />
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16">
        {/* Top bar */}
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-7" alt="TradeLoop" />
          <span className="font-semibold tracking-tight">TradeLoop</span>
          <span className="ms-1 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70">{t("Cases Drop")}</span>
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> {soldOut ? t("SOLD OUT") : t("LIVE")}
          </span>
        </div>

        {/* Hero */}
        <section className="mt-6 grid items-center gap-8 sm:mt-10 lg:grid-cols-2">
          <div className="order-2 text-center lg:order-1 lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wider text-white/70 uppercase">
              <Sparkles className="size-3.5 text-violet-300" /> {t("Limited drop")}
            </div>
            <h1 className="mt-4 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              {t("TRADELOOP")}
              <br />
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-sky-400 bg-clip-text text-transparent">{t("CASES DROP")}</span>
            </h1>
            <p className="mt-4 text-lg font-semibold text-white/80">{t("One case. Big rewards.")}</p>
            <p className="mt-1 text-sm text-white/55">{t("Claim your FREE case and discover your reward.")}</p>

            {!claimed && (
              <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
                <button
                  type="button"
                  onClick={() => (soldOut ? null : setConfirmOpen(true))}
                  disabled={soldOut}
                  className={cn(
                    "group inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-8 text-base font-bold transition-transform sm:w-auto",
                    soldOut
                      ? "cursor-not-allowed bg-white/10 text-white/40"
                      : "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_16px_40px_-12px_rgba(139,92,246,0.7)] hover:scale-[1.03]",
                  )}
                >
                  {soldOut ? <><Lock className="size-4" /> {t("DROP SOLD OUT")}</> : <><Gift className="size-5" /> {t("GET YOUR FREE CASE")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
                </button>
              </div>
            )}
            {claimed && (
              <div className="mt-7">
                <button
                  type="button"
                  onClick={() => document.getElementById("your-reward")?.scrollIntoView({ behavior: "smooth" })}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10"
                >
                  <PartyPopper className="size-4 text-fuchsia-300" /> {t("View your reward")}
                </button>
              </div>
            )}
            {error && <p className="mt-3 text-sm font-medium text-red-400">{error}</p>}

            <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs font-semibold text-white/60 lg:justify-start">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-violet-300" /> {t("100% FREE")}</span>
              <span className="inline-flex items-center gap-1.5"><Users className="size-4 text-violet-300" /> {t("1 CASE PER PERSON")}</span>
              <span className="inline-flex items-center gap-1.5"><Ticket className="size-4 text-violet-300" /> {t("ONLY {n} CASES", { n: drop.totalCases })}</span>
            </div>
          </div>

          <div className="order-1 flex justify-center lg:order-2">
            <CaseVisual className="w-[min(70vw,340px)]" tone={claimed && claim?.reward ? claim.reward.tone : "brand"} />
          </div>
        </section>

        {/* Drop status */}
        <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wider text-white/50 uppercase">{t("{n} cases only", { n: drop.totalCases })}</p>
              <p className="mt-1 text-2xl font-bold">
                {claimedCount} <span className="text-white/40">/ {drop.totalCases}</span> <span className="text-base font-semibold text-white/60">{t("claimed")}</span>
              </p>
            </div>
            <p className={cn("text-sm font-bold", soldOut ? "text-red-400" : "text-emerald-300")}>{soldOut ? t("Sold out") : t("{n} remaining", { n: remaining })}</p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-400 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          {drop.endAt && <Countdown endAt={drop.endAt} />}
        </section>

        {/* Rewards */}
        <section className="mt-12">
          <h2 className="text-center text-2xl font-bold tracking-tight">{t("What can you win?")}</h2>
          <p className="mt-1 text-center text-sm text-white/55">{t("Every case has a reward.")}</p>
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
              <div key={i} className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-violet-200">
                  <s.icon className="size-5" />
                </span>
                <p className="mt-2 text-xs font-semibold text-white/70">{i + 1}. {s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Your reward / waiting */}
        <section id="your-reward" className="mt-12 scroll-mt-6">
          {claimed && claim ? (
            <ClaimedPanel claim={claim} />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
              <CaseVisual className="mx-auto w-28" float={false} />
              <p className="mt-4 text-lg font-bold">{soldOut ? t("This drop is sold out") : t("Your case is waiting")}</p>
              <p className="mt-1 text-sm text-white/55">{soldOut ? t("All {n} cases have been claimed.", { n: drop.totalCases }) : t("Claim your free case and discover your reward.")}</p>
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0a0a18]/95 p-3 backdrop-blur sm:hidden">
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12121f] p-6 text-center shadow-2xl">
            <button type="button" onClick={() => setConfirmOpen(false)} aria-label={t("Close")} className="ms-auto flex size-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white">
              <X className="size-4" />
            </button>
            <CaseVisual className="mx-auto -mt-2 w-32" float={false} />
            <h3 className="mt-3 text-xl font-bold">{t("Ready to open your case?")}</h3>
            <p className="mt-1.5 text-sm text-white/60">{t("You can claim ONE case from this drop. Your reward will be randomly assigned.")}</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={claiming} className="h-12 flex-1 rounded-xl border border-white/15 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5 disabled:opacity-50">
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
            document.getElementById("your-reward")?.scrollIntoView({ behavior: "smooth" })
          }}
        />
      )}
    </div>
  )
}

function RewardCard({ reward }: { reward: CaseReward }) {
  const t = useT()
  return (
    <div className={cn("rounded-2xl border border-white/10 bg-white/[0.03] p-4 ring-1 ring-inset", TONE_RING[reward.tone])}>
      <p className={cn("text-3xl font-black", TONE_ACCENT[reward.tone])}>{reward.probability}%</p>
      <p className="text-[11px] font-semibold tracking-wider text-white/40 uppercase">{t("{n} cases", { n: reward.quantity })}</p>
      <p className="mt-2 text-sm font-bold leading-snug text-white">{reward.label}</p>
      {reward.remaining > 0 && reward.remaining < reward.quantity && (
        <p className="mt-1 text-[11px] font-medium text-emerald-300/80">{t("{n} remaining", { n: reward.remaining })}</p>
      )}
    </div>
  )
}

function ClaimedPanel({ claim }: { claim: CaseClaim }) {
  const t = useT()
  const tone = claim.reward?.tone ?? "common"
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 ring-1 ring-inset sm:p-8", TONE_RING[tone])}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
        <CaseVisual className="w-32 shrink-0" open tone={tone} float={false} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-white/60 uppercase">
            <PartyPopper className={cn("size-4", TONE_ACCENT[tone])} /> {t("Your reward")}
          </p>
          <p className={cn("mt-1 text-4xl font-black tracking-tight", TONE_ACCENT[tone])}>{claim.reward?.label ?? t("Reward")}</p>
          <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
            <PrizeCode code={claim.prizeCode} expiresAt={claim.expiresAt} status={claim.status} />
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
  if (ms <= 0) return <p className="mt-3 text-xs font-semibold text-red-400">{t("This drop has ended.")}</p>
  return (
    <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-white/60">
      <Timer className="size-3.5 text-violet-300" /> {t("Ends in")}{" "}
      <span className="font-mono font-semibold text-white/85">{d}d {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>
    </p>
  )
}
