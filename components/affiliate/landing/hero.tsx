import { ArrowDown, CircleDollarSign, Clock, ShieldCheck, Sparkle, TrendingUp, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { Eyebrow, containerClass } from "./parts"

// A drawn dashboard, not a photograph: an earnings card with its chart, and two
// cards floating beside it. The figures are an example and say so; the whole
// thing is decoration, hidden from assistive technology.
function EarningsIllustration({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative mx-auto aspect-[10/7] w-full max-w-[19rem] select-none sm:max-w-md", className)}>
      {/* the soft shape behind everything */}
      <div className="absolute inset-[6%] rounded-[45%_55%_60%_40%/55%_45%_55%_45%] bg-gradient-to-br from-primary/25 via-primary/12 to-sky-400/20 blur-2xl" />
      <svg viewBox="0 0 400 280" className="absolute inset-0 size-full text-primary/25" fill="none" stroke="currentColor" strokeWidth="1">
        <ellipse cx="200" cy="146" rx="186" ry="74" transform="rotate(-8 200 146)" />
      </svg>

      {/* the earnings card */}
      <div className="absolute start-[13%] top-[9%] w-[54%] -rotate-3 rounded-2xl border bg-card p-[5%] shadow-[0_18px_40px_-12px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground sm:text-xs">Your earnings</p>
          <span className="rounded-full bg-muted px-1.5 py-px text-[8px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[9px]">Example</span>
        </div>
        <p className="mt-1 text-base font-bold tabular-nums tracking-tight sm:text-xl">$2,480.00</p>
        <p className="flex items-center gap-1 text-[10px] font-medium text-[var(--gain)] sm:text-xs">
          <TrendingUp className="size-3" /> +12.5%
        </p>
        <svg viewBox="0 0 200 84" className="mt-1.5 w-full text-primary" fill="none">
          <defs>
            <linearGradient id="earn-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M4 72 L34 58 L58 64 L88 42 L112 49 L142 26 L164 32 L196 8 V84 H4 Z" fill="url(#earn-fill)" />
          <path d="M4 72 L34 58 L58 64 L88 42 L112 49 L142 26 L164 32 L196 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M182 8h14v14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* the brand, and what more referrals bring */}
      <div className="absolute end-[3%] top-[3%] flex rotate-2 items-center gap-1.5 rounded-xl border bg-card px-2.5 py-2 shadow-lg sm:gap-2 sm:px-3.5 sm:py-2.5">
        <BrandMark className="size-4 sm:size-5" />
        <span className="text-xs font-semibold tracking-tight sm:text-sm">TradeLoop</span>
      </div>
      <div className="absolute end-0 top-[47%] flex items-center gap-2 rounded-xl border bg-card px-2.5 py-2 shadow-lg sm:gap-2.5 sm:px-3.5 sm:py-3">
        <span className="flex size-6 items-center justify-center rounded-lg bg-primary/12 text-primary sm:size-8">
          <Users className="size-3.5 sm:size-4" />
        </span>
        <p className="text-[9px] font-medium leading-tight sm:text-xs">
          More referrals
          <br />
          Bigger rewards
        </p>
      </div>
      <div className="absolute bottom-[10%] start-[3%] flex size-10 items-center justify-center rounded-full border bg-card text-primary shadow-lg sm:size-14">
        <CircleDollarSign className="size-5 sm:size-7" />
      </div>
      <Sparkle className="absolute start-[6%] top-[14%] size-3.5 fill-primary/60 text-primary/60 sm:size-4" />
      <Sparkle className="absolute bottom-[14%] end-[14%] size-3 fill-primary/50 text-primary/50 sm:size-3.5" />
    </div>
  )
}

const BENEFITS = [
  { icon: CircleDollarSign, lines: ["High", "Commissions"] },
  { icon: Clock, lines: ["Real-Time", "Tracking"] },
  { icon: Users, lines: ["Dedicated", "Support"] },
  { icon: ShieldCheck, lines: ["Trusted", "Platform"] },
] as const

// The four promises, in one centred row at every width.
function HeroBenefits() {
  return (
    <ul className="mx-auto mt-9 grid max-w-2xl grid-cols-4 gap-1.5 sm:mt-12 sm:gap-6">
      {BENEFITS.map(({ icon: Icon, lines }) => (
        <li key={lines.join(" ")} className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-full border border-primary/20 bg-primary/8 text-primary sm:size-11">
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="text-[11px] font-medium leading-tight sm:text-sm">
            {lines[0]}
            <br />
            {lines[1]}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function AffiliateHero({ applyHref, tiersHref }: { applyHref: string; tiersHref: string }) {
  return (
    <section className="relative overflow-hidden">
      {/* restrained colour: one wash behind the picture, one at the far edge */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 end-[-8rem] size-[30rem] rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute -bottom-32 start-[-10rem] size-[24rem] rounded-full bg-sky-400/[0.06] blur-3xl" />
      </div>

      <div className={cn(containerClass, "relative pt-9 pb-10 sm:pt-14 sm:pb-14 lg:pt-16")}>
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
          <div>
            <Eyebrow>Affiliate program</Eyebrow>
            <h1 className="mt-4 text-[2rem] leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
              Partner with TradeLoop <span className="sm:block">and Earn More</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Join our affiliate program and turn your audience into income. Share TradeLoop with your community and get rewarded with competitive commissions, exclusive perks, and long-term growth.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href={applyHref} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40">
                Apply now <ArrowDown className="size-4" aria-hidden />
              </a>
              <a href={tiersHref} className="inline-flex h-10 items-center rounded-lg border bg-background px-5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">
                How tiers work
              </a>
            </div>
          </div>
          <EarningsIllustration />
        </div>
        <HeroBenefits />
      </div>
    </section>
  )
}
