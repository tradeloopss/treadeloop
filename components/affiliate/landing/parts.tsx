import { Caveat } from "next/font/google"
import { cn } from "@/lib/utils"

// Small pieces the sections of the public affiliate page share.

// The handwriting used for the page's few decorative annotations.
const hand = Caveat({ subsets: ["latin"], weight: ["500", "600"], display: "swap" })

// The small label above a section's heading.
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary", className)}>{children}</p>
}

// A handwritten aside with a little arrow. Decoration only: it repeats what the
// text beside it already says, so it is hidden from assistive technology.
export function HandNote({ children, arrow = "right", className }: { children: React.ReactNode; arrow?: "right" | "down" | "none"; className?: string }) {
  return (
    <p aria-hidden className={cn(hand.className, "pointer-events-none select-none text-[1.35rem] leading-[1.05] font-medium text-primary/75", className)}>
      {children}
      {arrow !== "none" && (
        <svg viewBox="0 0 48 20" className={cn("inline-block h-4 w-9 align-middle", arrow === "down" ? "ms-1 rotate-[55deg]" : "ms-1")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 14c10-9 24-11 42-6" />
          <path d="M36 3l8 5-7 6" />
        </svg>
      )}
    </p>
  )
}

// The width every section of the page shares.
export const containerClass = "mx-auto w-full max-w-6xl px-4 sm:px-6"
