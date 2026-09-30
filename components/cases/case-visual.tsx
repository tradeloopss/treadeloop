import { cn } from "@/lib/utils"

// The Cases Drop hero object: a premium, glowing TradeLoop "case", drawn with
// layered gradients + CSS (no image asset). `shaking` / `open` drive the
// opening animation; `tone` tints the glow on the reward reveal.
export function CaseVisual({
  className,
  shaking,
  open,
  tone = "brand",
  float = true,
}: {
  className?: string
  shaking?: boolean
  open?: boolean
  tone?: "brand" | "legendary" | "epic" | "rare" | "common"
  float?: boolean
}) {
  const glow =
    tone === "legendary"
      ? "from-amber-300/50 via-fuchsia-500/40 to-purple-600/40"
      : tone === "epic"
        ? "from-fuchsia-500/45 via-purple-500/40 to-indigo-600/40"
        : tone === "rare"
          ? "from-sky-400/45 via-blue-500/40 to-indigo-600/40"
          : tone === "common"
            ? "from-blue-400/40 via-indigo-500/35 to-purple-600/35"
            : "from-violet-500/45 via-indigo-500/40 to-blue-600/40"

  return (
    <div className={cn("relative aspect-square", float && "tl-float", className)}>
      {/* Halo */}
      <div className={cn("absolute inset-0 -z-10 rounded-full bg-gradient-to-br blur-3xl tl-glow", glow)} />

      {/* Case body */}
      <div className={cn("absolute inset-[12%] rounded-[22%] border border-white/10 bg-[linear-gradient(160deg,#20203a,#12121f_55%,#0c0c16)] shadow-[0_30px_80px_-20px_rgba(90,70,220,0.55)]", shaking && "tl-shake")}>
        {/* Inner bevel */}
        <div className="absolute inset-[6%] rounded-[20%] border border-white/[0.06] bg-[radial-gradient(120%_120%_at_50%_0%,rgba(140,120,255,0.18),transparent_60%)]" />

        {/* Lid — lifts and tilts back when open */}
        <div
          className="absolute inset-x-[6%] top-[6%] h-[42%] origin-top rounded-t-[20%] border-x border-t border-white/10 bg-[linear-gradient(180deg,#2a2a4d,#1a1a2e)] transition-transform duration-700 ease-out"
          style={open ? { transform: "translateY(-34%) rotateX(-62deg)", transformOrigin: "top center" } : undefined}
        >
          <div className="tl-sheen absolute inset-0 rounded-t-[20%]" />
        </div>

        {/* Seam / lock line */}
        <div className="absolute inset-x-[10%] top-[48%] h-px bg-gradient-to-r from-transparent via-violet-400/70 to-transparent" />
        <div className="absolute left-1/2 top-[48%] size-[9%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/40 bg-[radial-gradient(circle,rgba(150,120,255,0.9),rgba(80,60,180,0.25))] shadow-[0_0_24px_rgba(140,110,255,0.7)]" />

        {/* Emblem */}
        <div className="absolute inset-x-0 top-[16%] flex justify-center">
          <span className="text-[clamp(1rem,7vw,2.2rem)] font-black tracking-tighter text-white/90">TL</span>
        </div>

        {/* Corner accents */}
        <span className="absolute left-[10%] top-[10%] size-[6%] rounded-full bg-white/15" />
        <span className="absolute right-[10%] top-[10%] size-[6%] rounded-full bg-white/15" />
        <span className="absolute bottom-[10%] left-[10%] size-[6%] rounded-full bg-white/10" />
        <span className="absolute bottom-[10%] right-[10%] size-[6%] rounded-full bg-white/10" />
      </div>
    </div>
  )
}
