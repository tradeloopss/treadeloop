"use client"

import { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { Case3D, type Case3DHandle } from "@/components/cases/case-3d"
import { ClaimedCard } from "@/components/cases/claimed-card"
import { TONE_ACCENT, type CaseClaim } from "@/components/cases/types"

type Phase = "opening" | "reveal" | "closing" | "claimed"

// How long the reward is shown above the open case before it closes again.
const HOLD_OPEN_MS = 1400

// The full-screen opening: the 3D case plays its cinematic open, the reward
// rises above it on the burst, then the case closes and the "Claimed" card
// appears. The reward shown is the one the backend assigned — this component
// only reveals it.
export function OpeningOverlay({ claim, onDone }: { claim: CaseClaim; onDone: () => void }) {
  const t = useT()
  const caseRef = useRef<Case3DHandle>(null)
  const [phase, setPhase] = useState<Phase>("opening")
  const [flash, setFlash] = useState(0)
  const reward = claim.reward
  const accent = TONE_ACCENT[reward?.tone ?? "common"]

  useEffect(() => {
    caseRef.current?.open({ cinematic: true })
    // Never leave anyone stuck on the animation.
    const safety = setTimeout(() => setPhase("claimed"), 13000)
    return () => clearTimeout(safety)
  }, [])

  return (
    <div
      className="dark fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#07070f]/96 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("Opening your case")}
    >
      <div className="pointer-events-none fixed left-1/2 top-1/2 -z-10 size-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.2),transparent_62%)]" />
      {flash > 0 && <div key={flash} className="tl-flash pointer-events-none fixed inset-0 z-10 bg-[radial-gradient(ellipse_at_center,rgba(190,150,255,0.28),rgba(124,92,255,0.08)_45%,transparent_75%)]" />}

      <div className="relative flex w-full max-w-xl flex-col items-center py-4 text-center">
        {/* The reward, rising above the open case */}
        <div className="flex min-h-[96px] flex-col items-center justify-end sm:min-h-[112px]" aria-live="polite">
          {(phase === "reveal" || phase === "closing") && reward && (
            <div className="tl-reveal">
              <div className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-white/75 uppercase">
                <Sparkles className={cn("size-3.5", accent)} /> {t("Your reward")}
              </div>
              <p className={cn("text-4xl font-black tracking-tight sm:text-5xl", accent)}>{reward.label}</p>
            </div>
          )}
        </div>

        <div className={cn("w-full transition-all duration-500", phase === "claimed" && "scale-95 opacity-25 blur-[1px]")}>
          <Case3D
            ref={caseRef}
            className="h-[min(52vh,450px)] w-full"
            framing="stage"
            tone={reward?.tone ?? "brand"}
            forceDark
            interactive={false}
            clickMode="none"
            ariaLabel={t("Your TradeLoop case")}
            onBurst={() => {
              setFlash((n) => n + 1)
              setTimeout(() => setPhase((p) => (p === "opening" ? "reveal" : p)), 380)
            }}
            onOpened={() =>
              setTimeout(() => {
                setPhase((p) => (p === "claimed" ? p : "closing"))
                caseRef.current?.close()
              }, HOLD_OPEN_MS)
            }
            onClosed={() => setPhase("claimed")}
          />
        </div>

        {phase === "opening" && <p className="mt-1 text-xs font-medium tracking-[0.2em] text-white/45 uppercase">{t("Opening your case")}</p>}

      </div>

      {phase === "claimed" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto p-4">
          <div className="animate-in fade-in-0 zoom-in-95 w-full max-w-md duration-300">
            <ClaimedCard claim={claim} onClose={onDone} />
          </div>
        </div>
      )}
    </div>
  )
}
