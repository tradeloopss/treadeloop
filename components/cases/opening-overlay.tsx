"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { CaseVisual } from "@/components/cases/case-visual"
import { PrizeCode } from "@/components/cases/prize-code"
import { TONE_ACCENT, type CaseReward } from "@/components/cases/types"

type Stage = "lock" | "charge" | "shake" | "burst" | "revealed"

// The cinematic case-opening sequence: the case moves in and locks, charges
// with purple energy, shakes, then bursts open with light and reveals the
// backend-assigned reward. Stages advance on timers; reduced-motion users get a
// short closed→open→reward transition instead.
export function OpeningOverlay({
  reward,
  prizeCode,
  expiresAt,
  onDone,
}: {
  reward: CaseReward
  prizeCode: string
  expiresAt: string
  onDone: () => void
}) {
  const t = useT()
  const [stage, setStage] = useState<Stage>("lock")
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const seq: [Stage, number][] = reduce
      ? [["burst", 150], ["revealed", 450]]
      : [["charge", 400], ["shake", 1100], ["burst", 1800], ["revealed", 2450]]
    seq.forEach(([s, at]) => timers.current.push(setTimeout(() => setStage(s), at)))
    return () => timers.current.forEach(clearTimeout)
  }, [])

  const accent = TONE_ACCENT[reward.tone]
  const charging = stage === "charge" || stage === "shake" || stage === "burst"
  const active = stage !== "lock" && stage !== "revealed"
  const label = stage === "lock" ? t("Unlocking…") : stage === "charge" ? t("Charging…") : stage === "shake" ? t("Almost there…") : ""

  const caseScale = stage === "lock" ? "scale-90" : stage === "burst" ? "scale-[1.06]" : "scale-100"

  return (
    <div className="dark fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#07070f]/96 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("Opening your case")}>
      {/* Ambient */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[86vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.22),transparent_62%)]" />

      {stage !== "revealed" ? (
        <div className="relative flex flex-col items-center">
          <div className="relative">
            {/* Light rays behind the case */}
            <div className={cn("pointer-events-none absolute inset-0 -z-10 flex items-center justify-center transition-opacity duration-500", active ? "opacity-100" : "opacity-0")}>
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className="absolute h-[150%] w-[2px] bg-gradient-to-t from-transparent via-violet-400/40 to-transparent" style={{ transform: `rotate(${i * 36}deg)` }} />
              ))}
            </div>

            <CaseVisual
              className={cn("w-[min(84vw,520px)] transition-transform duration-500 ease-out", caseScale)}
              tone={reward.tone}
              float={false}
              glow
              charging={charging}
              shaking={stage === "shake"}
              open={stage === "burst"}
            />

            {/* Light burst on open */}
            {stage === "burst" && (
              <>
                <div className="tl-burst pointer-events-none absolute left-1/2 top-[34%] size-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(235,225,255,0.95),rgba(150,120,255,0.55)_40%,transparent_72%)]" />
                <div className="pointer-events-none absolute inset-0 animate-[tl-glow_0.7s_ease-out] bg-violet-400/15" />
                {Array.from({ length: 14 }).map((_, i) => (
                  <span
                    key={i}
                    className={cn("pointer-events-none absolute left-1/2 top-[34%] block size-1.5 rounded-full", i % 2 ? "bg-fuchsia-400" : "bg-sky-300")}
                    style={{ transform: `rotate(${i * 26}deg) translateY(-10px)`, animation: `tl-spark ${0.7 + (i % 4) * 0.2}s ease-out ${i * 0.02}s forwards` }}
                  />
                ))}
              </>
            )}
          </div>

          {label && <p className="mt-6 animate-pulse text-sm font-semibold tracking-[0.3em] text-white/70 uppercase">{label}</p>}
        </div>
      ) : (
        <div className="tl-rise relative w-full max-w-md text-center">
          {/* sparks */}
          <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center">
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className={cn("absolute block size-1.5 rounded-full", i % 2 ? "bg-fuchsia-400" : "bg-sky-300")}
                style={{ left: `${10 + i * 8}%`, animation: `tl-spark ${0.9 + (i % 4) * 0.25}s ease-out ${i * 0.05}s forwards` }}
              />
            ))}
          </div>

          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wider text-white/80 uppercase">
            <Sparkles className={cn("size-3.5", accent)} /> {t("You won!")}
          </div>

          <p className={cn("text-5xl font-black tracking-tight sm:text-6xl", accent)}>{reward.label}</p>
          {reward.type === "free_subscription" && <p className="mt-1 text-lg font-semibold text-white/80">{t("on us — enjoy TradeLoop")}</p>}

          {/* A faint open case behind the prize */}
          <CaseVisual className="mx-auto mt-4 w-40 opacity-70" tone={reward.tone} float={false} open glow />

          <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
            <PrizeCode code={prizeCode} expiresAt={expiresAt} rewardType={reward.type} />
          </div>

          <button
            type="button"
            onClick={onDone}
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-8 text-base font-semibold text-neutral-900 transition-transform hover:scale-[1.02]"
          >
            <Check className="size-4" /> {t("Awesome")}
          </button>
        </div>
      )}
    </div>
  )
}
