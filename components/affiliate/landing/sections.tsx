import { BadgeDollarSign, Headset, Link2, type LucideIcon, Megaphone, ShieldCheck, Sprout, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
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
        {/* four across from a phone up; two by two only on the narrowest screens */}
        <ul className="mx-auto mt-8 grid max-w-5xl grid-cols-2 gap-x-3 gap-y-6 min-[420px]:grid-cols-4 sm:gap-x-6">
          {items.map((item) => {
            const Icon = WHY_ICONS[item.icon]
            return (
              <li key={item.title} className="flex flex-col items-center gap-2.5 sm:flex-row sm:items-start sm:gap-3 sm:text-start lg:px-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-xs font-semibold leading-tight sm:text-sm">{item.title}</p>
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

// --- Footer -------------------------------------------------------------------------

export function AffiliateFooter({ homeHref, links }: { homeHref: string; links: { label: string; href: string }[] }) {
  return (
    <footer className="border-t">
      <div className={cn(containerClass, "flex flex-col items-center gap-4 py-7 text-xs text-muted-foreground sm:flex-row sm:justify-between")}>
        <a href={homeHref} className="flex items-center gap-2 rounded-md text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <BrandMark className="size-6" />
          <span className="text-sm font-semibold tracking-tight">TradeLoop</span>
        </a>
        <p>© {new Date().getFullYear()} TradeLoop. Built for better trading.</p>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {links.map((l) => (
            <a key={l.label} href={l.href} className="rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
