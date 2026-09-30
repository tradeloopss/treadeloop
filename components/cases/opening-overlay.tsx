"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { Case3D, type Case3DHandle } from "@/components/cases/case-3d"
import { PrizeCode } from "@/components/cases/prize-code"
import { TONE_ACCENT, type CaseReward } from "@/components/cases/types"

type Phase = "opening" | "reveal" | "done"

// The full-screen opening: the 3D case plays its cinematic sequence (lock →
// charge → shake → unlock → lid → burst), the reward rises above the open case
// on the burst, then the prize card slides in. The reward shown is the one the
// backend assigned — this component only reveals it.
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
  const caseRef = useRef<Case3DHandle>(null)
  const [phase, setPhase] = useState<Phase>("opening")
  const [flash, setFlash] = useState(0)
  const accent = TONE_ACCENT[reward.tone]

  useEffect(() => {
    caseRef.current?.open({ cinematic: true })
    // Never leave anyone stuck on the animation.
    const safety = setTimeout(() => setPhase("done"), 9000)
    return () => clearTimeout(safety)
  }, [])

  return (
    <div
      className="dark fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#07070f]/96 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("Opening your case")}
    >
      <div className="pointer-events-none fixed left-1/2 top-1/2 -z-10 size-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.24),transparent_62%)]" />
      {flash > 0 && <div key={flash} className="tl-flash pointer-events-none fixed inset-0 z-10 bg-[radial-gradient(ellipse_at_center,rgba(190,150,255,0.45),rgba(124,92,255,0.12)_45%,transparent_75%)]" />}

      <div className="relative flex w-full max-w-xl flex-col items-center py-4 text-center">
        {/* The reward, rising above the open case */}
        <div className="flex min-h-[104px] flex-col items-center justify-end sm:min-h-[120px]" aria-live="polite">
          {phase !== "opening" && (
            <div className="tl-reveal">
              <div className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wider text-white/80 uppercase">
                <Sparkles className={cn("size-3.5", accent)} /> {t("You won!")}
              </div>
              <p className={cn("text-4xl font-black tracking-tight drop-shadow-[0_0_28px_rgba(168,85,247,0.55)] sm:text-6xl", accent)}>{reward.label}</p>
              {reward.type === "free_subscription" && <p className="mt-1 text-base font-semibold text-white/80">{t("on us — enjoy TradeLoop")}</p>}
            </div>
          )}
        </div>

        <Case3D
          ref={caseRef}
          className={cn("w-full transition-[height] duration-700 ease-out", phase === "done" ? "h-[min(34vh,300px)]" : "h-[min(54vh,470px)]")}
          framing="stage"
          tone={reward.tone}
          forceDark
          interactive={phase === "done"}
          clickMode="none"
          ariaLabel={t("Your TradeLoop case")}
          onBurst={() => {
            setFlash((n) => n + 1)
            setTimeout(() => setPhase((p) => (p === "opening" ? "reveal" : p)), 380)
          }}
          onOpened={() => setPhase("done")}
        />

        {phase === "opening" && <p className="mt-2 animate-pulse text-xs font-semibold tracking-[0.3em] text-white/60 uppercase">{t("Opening your case…")}</p>}

        {phase === "done" && (
          <div className="tl-rise w-full">
            <div className="mx-auto mt-2 max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
              <PrizeCode code={prizeCode} expiresAt={expiresAt} rewardType={reward.type} />
            </div>
            <button
              type="button"
              onClick={onDone}
              className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-8 text-base font-semibold text-neutral-900 transition-transform hover:scale-[1.02]"
            >
              <Check className="size-4" /> {t("Awesome")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
