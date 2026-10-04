import { cn } from "@/lib/utils"

// The mark on anything that isn't released yet. One look everywhere: a small,
// muted pill in the brand's purple and blue — never red, it isn't a warning.
export function ComingSoonBadge({ className, short }: { className?: string; short?: boolean }) {
  return (
    <span className={cn("inline-flex w-fit items-center rounded-full bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_18%,transparent),color-mix(in_oklab,#3b82f6_18%,transparent))] px-1.5 py-px text-[9px] leading-4 font-semibold tracking-wider whitespace-nowrap text-primary/80 uppercase", className)}>
      {short ? "Soon" : "Coming soon"}
    </span>
  )
}
