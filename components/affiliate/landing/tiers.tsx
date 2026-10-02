import { ArrowDown, ArrowRight, BadgePercent, CircleCheck, Crown, Gem, Gift, Handshake, type LucideIcon, RefreshCw, TrendingUp, Trophy } from "lucide-react"
import { TIER_PERKS, tierHasPerk, type TierPerk, type TierRow } from "@/lib/affiliates/engine"
import { cn } from "@/lib/utils"
import { Eyebrow, HandNote, containerClass } from "./parts"

// THE TIERS ARE NOT PLANS. An affiliate applies once; the tier they sit in is
// worked out from their paying customers and moves up on its own. So nothing in
// this section can be chosen: no buttons, no links, no selectable cards — it
// shows the ladder, read from the live tiers the commission engine uses.

const perkText = (perk: TierPerk, couponPercent: number) =>
  perk === "coupon" ? `Personal ${couponPercent}% off coupon code for your audience` : perk === "beta" ? "Beta feature access" : perk === "freeAccount" ? "Free-forever TradeLoop account" : "Priority support & feature requests"

// What every affiliate has, whatever their tier.
const BASE_BENEFITS = ["Real-time tracking", "Marketing resources", "Email support"]

const whoFor = (i: number, n: number) => (i === 0 ? "For new affiliates" : i === n - 1 ? "For top performers" : i === 1 ? "For active affiliates" : "For established partners")
const iconFor = (i: number, n: number): LucideIcon => (i === 0 ? BadgePercent : i === n - 1 ? Gem : i === 1 ? Crown : Trophy)

// "1–10 paying customers", "300+ paying customers"
function threshold(tier: TierRow, next: TierRow | undefined) {
  const from = Math.max(1, tier.minCustomers).toLocaleString("en-US")
  if (!next) return `${from}+ paying customers`
  const to = next.minCustomers - 1
  return to <= tier.minCustomers ? `${from} paying customer${tier.minCustomers === 1 ? "" : "s"}` : `${from}–${to.toLocaleString("en-US")} paying customers`
}

function commissionLine(t: TierRow) {
  if (t.introMonths == null) return `${t.ratePercent}% commission on every sale`
  const first = `${t.ratePercent}% for a customer's first ${t.introMonths} month${t.introMonths === 1 ? "" : "s"}`
  return t.afterPercent != null && t.afterPercent > 0 ? `${first}, then ${t.afterPercent}% lifetime` : first
}

// The benefits of a tier: everything in the one below (when that is true), its
// commission, and what it adds.
function benefits(t: TierRow, prev: TierRow | null, couponPercent: number): string[] {
  if (!prev) return [commissionLine(t), ...BASE_BENEFITS, ...TIER_PERKS.filter((k) => tierHasPerk(t, k)).map((k) => perkText(k, couponPercent))]
  const inherits = TIER_PERKS.every((k) => !tierHasPerk(prev, k) || tierHasPerk(t, k))
  const own = TIER_PERKS.filter((k) => tierHasPerk(t, k) && !(inherits && tierHasPerk(prev, k)))
  return [...(inherits ? [`All ${prev.name} benefits`] : BASE_BENEFITS), commissionLine(t), ...own.map((k) => perkText(k, couponPercent))]
}

const STEPS = ["Join once", "Grow your referrals", "Your tier upgrades automatically"]

export function AffiliateTierProgression({ tiers, couponPercent, recurring, id }: { tiers: TierRow[]; couponPercent: number; recurring: boolean; id?: string }) {
  const list = tiers.filter((t) => t.enabled).sort((a, b) => a.minCustomers - b.minCustomers || a.id - b.id)
  if (list.length === 0) return null
  const n = list.length
  const unlocks: [LucideIcon, string, string][] = [
    [TrendingUp, "Higher earnings", "The more paying customers you refer, the higher your rate."],
    [Gift, "Exclusive perks", "Each tier adds its perks on top of the ones before it."],
    [Handshake, "Long-term partnership", recurring ? "Recurring commission while your referrals stay subscribed." : "Built for your success, tier after tier."],
  ]

  return (
    <section id={id} aria-labelledby="tiers-heading" className="scroll-mt-16 border-y bg-primary/[0.03]">
      <div className={cn(containerClass, "relative py-12 sm:py-16")}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 sm:block sm:text-center">
          <div>
            <Eyebrow>How it works</Eyebrow>
            <h2 id="tiers-heading" className="mt-3 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              Your Tier Unlocks More Benefits
            </h2>
          </div>
          <HandNote arrow="down" className="mt-7 max-w-[8.5rem] rotate-[-7deg] text-[1.15rem] max-[379px]:hidden sm:hidden">
            Higher tiers = more rewards and exclusive features.
          </HandNote>
          <p className="col-span-2 mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:mx-auto">
            Your commission tier is <span className="font-medium text-foreground">automatically assigned</span> based on your performance. The more qualified referrals and activity you generate, the higher your tier and rewards — with greater perks at every level.
          </p>
        </div>
        <HandNote className="absolute end-6 top-14 hidden max-w-[11rem] rotate-[-7deg] xl:block">Higher tiers = more rewards and exclusive features.</HandNote>

        {/* how you move through them */}
        <ol className="mx-auto mt-7 flex max-w-3xl flex-col gap-2 rounded-2xl border bg-card px-4 py-3 text-sm shadow-xs sm:flex-row sm:items-center sm:justify-center sm:gap-3 sm:rounded-full sm:px-5 sm:py-2.5">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-2.5 sm:gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{i + 1}</span>
              <span className={cn("font-medium", i === STEPS.length - 1 && "text-primary")}>{step}</span>
              {i < STEPS.length - 1 && <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block rtl:rotate-180" aria-hidden />}
            </li>
          ))}
        </ol>

        <ol className={cn("mt-8 grid gap-x-4 gap-y-7 sm:gap-y-5", n >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : n === 3 ? "md:grid-cols-3" : n === 2 ? "md:grid-cols-2" : "mx-auto max-w-md")}>
          {list.map((t, i) => {
            const prev = i > 0 ? list[i - 1] : null
            const Icon = iconFor(i, n)
            // The step after the one everyone starts on: where a new affiliate is headed.
            const next = n > 1 && i === 1
            return (
              <li key={t.id} className={cn("relative flex flex-col rounded-2xl border bg-card p-5 shadow-xs", next && "border-primary/45 bg-gradient-to-b from-primary/[0.09] to-card shadow-md ring-1 ring-primary/25")}>
                {next && <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-primary-foreground rtl:translate-x-1/2">Next level</span>}
                {/* the way up: an arrow to the next card */}
                {i < n - 1 && (
                  <>
                    <ArrowDown className="absolute -bottom-[1.4rem] start-1/2 size-4 -translate-x-1/2 text-primary/60 md:hidden" aria-hidden />
                    <ArrowRight className={cn("absolute -end-[0.95rem] top-9 z-10 hidden size-4 text-primary/60 rtl:rotate-180", n >= 4 ? "xl:block" : "md:block")} aria-hidden />
                  </>
                )}

                <div className="flex items-start gap-3">
                  <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", next ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Level {i + 1}</p>
                    <h3 className="truncate text-base font-semibold leading-tight">{t.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{whoFor(i, n)}</p>
                  </div>
                </div>

                <p className="mt-4 self-start rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{threshold(t, list[i + 1])}</p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {/* "up to": a tier with a schedule pays this for a customer's first months, less after */}
                  {t.introMonths != null ? "Up to " : ""}
                  <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{t.ratePercent}%</span> commission
                </p>

                <ul className="mt-4 grid gap-2 text-[13px] leading-snug min-[420px]:max-md:grid-cols-2">
                  {benefits(t, prev, couponPercent).map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <CircleCheck className="mt-px size-4 shrink-0 text-primary" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-auto flex items-center gap-1.5 pt-5 text-xs text-muted-foreground">
                  <RefreshCw className="size-3.5" aria-hidden />
                  {i === 0 ? "Where every affiliate starts" : "Unlocked automatically"}
                </p>
              </li>
            )
          })}
        </ol>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground">
          You don&apos;t choose a tier and there is nothing to pay. You apply once — TradeLoop moves you up as your paying customers grow.
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {unlocks.map(([Icon, title, body]) => (
            <li key={title} className="flex items-start gap-3 rounded-xl border bg-card/70 px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/8 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
