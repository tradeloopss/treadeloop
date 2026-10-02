import { BadgeDollarSign, Headset, Link2, type LucideIcon, Megaphone, ShieldCheck, Sprout, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { Eyebrow, HandNote, containerClass } from "./parts"

// --- The application ---------------------------------------------------------------
// One card, two halves: what joining involves on the left, and on the right
// whatever applies to this visitor — the form, a way to sign in first, or where
// their application stands. It comes AFTER the tiers on purpose.

export type ApplicationPoint = { icon: "link" | "earn" | "grow"; title: string; body: string }
const POINT_ICONS: Record<ApplicationPoint["icon"], LucideIcon> = { link: Link2, earn: Wallet, grow: Sprout }

export function AffiliateApplication({ id, description, points, children }: { id?: string; description: string; points: ApplicationPoint[]; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby="apply-heading" className="scroll-mt-16">
      <div className={cn(containerClass, "py-12 sm:py-16")}>
        <div className="grid overflow-hidden rounded-3xl border bg-card shadow-sm lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="relative overflow-hidden bg-gradient-to-br from-primary/[0.09] via-primary/[0.04] to-transparent p-6 sm:p-8 lg:border-e">
            <div aria-hidden className="pointer-events-none absolute -bottom-20 -start-16 size-56 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative">
              <Eyebrow>Apply now</Eyebrow>
              <h2 id="apply-heading" className="mt-3 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
                Become a TradeLoop Affiliate
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
              <ul className="mt-6 flex flex-col gap-4">
                {points.map((p) => {
                  const Icon = POINT_ICONS[p.icon]
                  return (
                    <li key={p.title} className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{p.title}</p>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{p.body}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <HandNote className="mt-8 hidden w-fit rotate-[-6deg] ps-4 lg:block">
                Let&apos;s grow
                <br />
                together
              </HandNote>
            </div>
          </div>
          <div className="p-5 sm:p-8">{children}</div>
        </div>
      </div>
    </section>
  )
}

// --- Why join -----------------------------------------------------------------------

export type WhyItem = { icon: "commission" | "marketing" | "support" | "trust"; title: string; body: string }
const WHY_ICONS: Record<WhyItem["icon"], LucideIcon> = { commission: BadgeDollarSign, marketing: Megaphone, support: Headset, trust: ShieldCheck }

export function AffiliateBenefits({ items }: { items: WhyItem[] }) {
  return (
    <section aria-labelledby="why-heading" className="border-t bg-primary/[0.03]">
      <div className={cn(containerClass, "py-12 text-center sm:py-16")}>
        <Eyebrow>Why join?</Eyebrow>
        <h2 id="why-heading" className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
          Your Success Matters
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">At TradeLoop, we provide the tools, resources, and support you need to turn your audience into income.</p>
        {/* Every title stays on ONE line at every width. That decides the layout: two by two on phones
            and tablets (four across would break "Competitive Commissions" in two), four across on a desktop. */}
        <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-8 lg:grid-cols-4 lg:gap-x-6">
          {items.map((item) => {
            const Icon = WHY_ICONS[item.icon]
            return (
              <li key={item.title} className="flex flex-col items-center gap-2.5 sm:flex-row sm:items-start sm:gap-3 sm:text-start">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-[11px] font-semibold leading-tight whitespace-nowrap min-[360px]:text-xs sm:text-sm">{item.title}</p>
                  <p className="mt-1 hidden text-[13px] leading-relaxed text-muted-foreground sm:block">{item.body}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
