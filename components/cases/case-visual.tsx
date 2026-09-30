import { cn } from "@/lib/utils"

// The TradeLoop loot case — the premium rendered case (public/cases/case-closed.png),
// edge-masked so it floats cleanly on a light OR dark background, with layered
// glow overlays for the opening sequence. One case design for the whole drop.
//  - `glow`     : ambient purple bloom behind/under the case
//  - `float`    : slow idle float
//  - `shaking`  : shake keyframe (opening)
//  - `charging` : the case "powers up" — an intensifying purple bloom
//  - `open`     : light pours from the lid seam + interior glow

const TONE_GLOW: Record<string, string> = {
  brand: "rgba(139,92,246,0.55)",
  legendary: "rgba(251,191,36,0.5)",
  epic: "rgba(232,121,249,0.55)",
  rare: "rgba(56,189,248,0.55)",
  common: "rgba(129,140,248,0.5)",
}

// Fades the rendered scene's edges into transparency so the case sits on any
// background without a hard rectangle; the case itself stays fully opaque.
const EDGE_MASK = "radial-gradient(ellipse 90% 94% at 50% 47%, #000 68%, transparent 93%)"

export function CaseVisual({
  className,
  tone = "brand",
  open,
  charging,
  shaking,
  float = true,
  glow = true,
}: {
  className?: string
  tone?: "brand" | "legendary" | "epic" | "rare" | "common"
  open?: boolean
  charging?: boolean
  shaking?: boolean
  float?: boolean
  glow?: boolean
}) {
  const g = TONE_GLOW[tone] ?? TONE_GLOW.brand
  return (
    <div className={cn("relative select-none", float && "tl-float", className)}>
      {/* Ambient glow behind + under the case */}
      {glow && (
        <div
          className="pointer-events-none absolute inset-x-[6%] bottom-[4%] top-[18%] -z-10 rounded-[45%] blur-2xl tl-glow"
          style={{ background: `radial-gradient(60% 55% at 50% 60%, ${g}, transparent 70%)` }}
        />
      )}

      <div className={cn("relative", shaking && "tl-shake")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cases/case-closed.png" alt="" className="block w-full" draggable={false} style={{ WebkitMaskImage: EDGE_MASK, maskImage: EDGE_MASK }} />

        {/* Charge — the whole case blooms purple as it powers up */}
        {charging && (
          <div
            className="pointer-events-none absolute inset-0 mix-blend-screen tl-glow"
            style={{ background: `radial-gradient(45% 42% at 50% 44%, ${g}, transparent 66%)` }}
          />
        )}

        {/* Open — a bright seam of light at the lid, plus interior glow rising */}
        {open && (
          <>
            <div
              className="pointer-events-none absolute inset-x-[24%] top-[15%] h-[8%] mix-blend-screen blur-md"
              style={{ background: "radial-gradient(60% 100% at 50% 50%, rgba(226,214,255,0.95), rgba(160,120,255,0.6) 45%, transparent 78%)" }}
            />
            <div
              className="pointer-events-none absolute inset-x-[20%] top-[16%] h-[30%] mix-blend-screen blur-lg"
              style={{ background: `radial-gradient(52% 72% at 50% 0%, ${g}, transparent 76%)` }}
            />
          </>
        )}
      </div>
    </div>
  )
}

// The hero presentation of the case — just the premium case with its glow, no
// floating icon tiles (this is a real case, not a UI card).
export function CaseShowcase({
  className,
  tone = "brand",
}: {
  className?: string
  tone?: "brand" | "legendary" | "epic" | "rare" | "common"
}) {
  return <CaseVisual className={className} tone={tone} float glow />
}
