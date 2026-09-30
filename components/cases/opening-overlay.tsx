"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { CaseVisual } from "@/components/cases/case-visual"
import { PrizeCode } from "@/components/cases/prize-code"
import { TONE_ACCENT, type CaseReward } from "@/components/cases/types"

type Stage = "opening" | "burst" | "revealed"

// The full-screen case-opening experience: the case shakes, a light bursts,
// then the reward rises into view. Timers advance the stages; reduced-motion
// users jump near-instantly to the reveal.
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
  const [stage, setStage] = useState<Stage>("opening")
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const a = reduce ? 150 : 1500
    const b = reduce ? 250 : 2100
    timers.current.push(setTimeout(() => setStage("burst"), a))
    timers.current.push(setTimeout(() => setStage("revealed"), b))
    return () => timers.current.forEach(clearTimeout)
  }, [])

  const accent = TONE_ACCENT[reward.tone]

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#07070f]/95 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("Opening your case")}>
      {/* ambient glows */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[80vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.25),transparent_60%)]" />

      {stage !== "revealed" ? (
        <div className="relative flex flex-col items-center">
          <CaseVisual className="w-[min(72vw,360px)]" shaking={stage === "opening"} open={stage === "burst"} float={false} />
          {stage === "burst" && <div className="tl-burst pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.95),rgba(150,120,255,0.5)_40%,transparent_70%)]" />}
          <p className="mt-8 animate-pulse text-sm font-semibold tracking-[0.3em] text-white/70 uppercase">{t("Opening…")}</p>
        </div>
      ) : (
        <div className="tl-rise relative w-full max-w-md text-center">
          {/* sparks */}
          <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
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

          <div className="mx-auto mt-7 max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
            <PrizeCode code={prizeCode} expiresAt={expiresAt} />
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

// A tiny standalone copy button used in a couple of places.
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        } catch {
          /* clipboard blocked — ignore */
        }
      }}
      className={cn("inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors", className)}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {done ? t("Copied") : t("Copy code")}
    </button>
  )
}
