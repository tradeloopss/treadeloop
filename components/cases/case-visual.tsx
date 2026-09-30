import { cn } from "@/lib/utils"

// A stylised TradeLoop "case" drawn with CSS (no image) — a rugged, chamfered
// hardware case with neon-purple side handles, corner bolts, a hex emblem and
// the tradeloop.pro wordmark, matching the promo render. Used in the opening
// animation and the smaller thumbnails; the hero uses the full render.
// `shaking` / `open` drive the opening animation; `tone` tints the glow.
const CHAMFER = "polygon(10% 0,90% 0,100% 13%,100% 87%,90% 100%,10% 100%,0 87%,0 13%)"

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
      ? "from-amber-300/50 via-fuchsia-500/45 to-purple-600/45"
      : tone === "epic"
        ? "from-fuchsia-500/50 via-purple-500/45 to-indigo-600/45"
        : tone === "rare"
          ? "from-sky-400/50 via-blue-500/45 to-indigo-600/45"
          : tone === "common"
            ? "from-blue-400/45 via-indigo-500/40 to-purple-600/40"
            : "from-violet-500/50 via-fuchsia-500/40 to-blue-600/45"

  return (
    <div className={cn("relative aspect-square", float && "tl-float", className)}>
      {/* Halo */}
      <div className={cn("absolute inset-[6%] -z-10 rounded-full bg-gradient-to-br blur-3xl tl-glow", glow)} />

      <div className={cn("absolute inset-[9%]", shaking && "tl-shake")}>
        {/* Neon side handles (behind the body) */}
        <span className="absolute left-[-2%] top-[30%] h-[40%] w-[7%] rounded-md bg-gradient-to-b from-violet-400 to-fuchsia-500 shadow-[0_0_22px_rgba(168,120,255,0.8)]" />
        <span className="absolute right-[-2%] top-[30%] h-[40%] w-[7%] rounded-md bg-gradient-to-b from-violet-400 to-fuchsia-500 shadow-[0_0_22px_rgba(168,120,255,0.8)]" />

        {/* Case body (chamfered) */}
        <div
          className="absolute inset-0 border border-white/10 bg-[linear-gradient(160deg,#242445,#14141f_55%,#0b0b14)] shadow-[inset_0_0_30px_rgba(120,100,255,0.15),0_30px_70px_-20px_rgba(90,70,220,0.6)]"
          style={{ clipPath: CHAMFER }}
        >
          {/* Inner frame */}
          <div className="absolute inset-[7%] border border-white/[0.07]" style={{ clipPath: CHAMFER }} />

          {/* Lid — lifts and tilts back when open */}
          <div
            className="absolute inset-x-0 top-0 h-[42%] origin-top border-b border-violet-400/30 bg-[linear-gradient(180deg,#2c2c52,#1b1b30)] transition-transform duration-700 ease-out"
            style={{ clipPath: "polygon(10% 0,90% 0,100% 30%,100% 100%,0 100%,0 30%)", ...(open ? { transform: "translateY(-30%) rotateX(-64deg)", transformOrigin: "top center" } : {}) }}
          >
            <div className="tl-sheen absolute inset-0" />
          </div>

          {/* Seam + center lock glow */}
          <div className="absolute inset-x-[12%] top-[46%] h-[2px] bg-gradient-to-r from-transparent via-violet-300/80 to-transparent" />
          <div className="absolute left-1/2 top-[46%] size-[8%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-200/50 bg-[radial-gradient(circle,rgba(180,150,255,0.95),rgba(90,60,190,0.3))] shadow-[0_0_26px_rgba(150,110,255,0.85)]" />

          {/* Corner bolts */}
          <span className="absolute left-[8%] top-[9%] size-[7%] rounded-[3px] bg-white/15 shadow-inner" />
          <span className="absolute right-[8%] top-[9%] size-[7%] rounded-[3px] bg-white/15 shadow-inner" />
          <span className="absolute bottom-[9%] left-[8%] size-[7%] rounded-[3px] bg-white/12 shadow-inner" />
          <span className="absolute bottom-[9%] right-[8%] size-[7%] rounded-[3px] bg-white/12 shadow-inner" />

          {/* Hex emblem + wordmark */}
          <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center">
            <span
              className="flex size-[26%] items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-[0_0_20px_rgba(150,110,255,0.6)]"
              style={{ clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)" }}
            >
              <span className="text-[clamp(0.6rem,3.6vw,1.1rem)] font-black tracking-tighter text-white">TL</span>
            </span>
            <span className="mt-[4%] text-[clamp(0.45rem,2.4vw,0.8rem)] font-bold tracking-tight text-white/85">
              tradeloop<span className="text-violet-300">.pro</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
