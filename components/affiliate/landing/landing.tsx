import { ArrowRight, Clock, ShieldAlert, UserPlus, XCircle } from "lucide-react"
import type { TierRow } from "@/lib/affiliates/engine"
import { money, type ProgramSettings } from "@/lib/affiliates/types"
import { ApplyForm } from "@/components/affiliate/apply-form"
import { AffiliateNavbar } from "./nav"
import { AffiliateHero } from "./hero"
import { AffiliateTierProgression } from "./tiers"
import { AffiliateApplication, AffiliateBenefits, AffiliateFooter } from "./sections"

// The public affiliate page, drawn from plain data (app/affiliate/apply/page.tsx
// loads it). Order matters: hero → how the tiers work → the application → why
// join. (The program terms are a page of their own: ./terms.tsx.) The tiers are a ladder an affiliate climbs automatically, never a
// choice, so the only thing on this page that can be applied for is the
// program itself.

export type LandingAffiliate = { status: string; firstName: string; lastName: string; email: string; country: string | null; website: string | null; audienceSize: string | null; trafficSource: string | null; promotionMethod: string | null; reason: string | null; rejectionReason: string | null }

export type LandingProps = {
  user: { name: string; email: string } | null
  // their application, if they made one (an approved affiliate never sees this page)
  affiliate: LandingAffiliate | null
  program: ProgramSettings
  tiers: TierRow[]
  // "PayPal, Wise or USDT (TRC-20)"
  payoutMethods: string
  // the visitor's country, to prefill the form
  country: string
  countries: { code: string; name: string }[]
  // `terms`: the program terms, on their own page
  urls: { site: string; help: string; self: string; terms: string; signIn: string; signUp: string; app: string }
}

// Where an application stands, in place of the form.
function StatusCard({ icon: Icon, title, children, tone = "muted" }: { icon: typeof Clock; title: string; children: React.ReactNode; tone?: "muted" | "loss" }) {
  return (
    <div className="rounded-2xl border bg-background/60 p-6 text-center sm:p-8" role="status">
      <span className={`mx-auto flex size-12 items-center justify-center rounded-full ${tone === "loss" ? "bg-[var(--loss)]/12 text-[var(--loss)]" : "bg-primary/12 text-primary"}`}>
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
      <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

export function AffiliateLanding({ user, affiliate, program, tiers, payoutMethods, country, countries, urls }: LandingProps) {
  const activeTiers = tiers.filter((t) => t.enabled).sort((a, b) => a.minCustomers - b.minCustomers)
  // With tiers, what the program pays is what the tiers pay; the default rate only applies without them.
  const topRate = activeTiers.length ? Math.max(...activeTiers.map((t) => t.ratePercent)) : program.defaultRate
  const startRate = activeTiers.length ? activeTiers[0].ratePercent : program.defaultRate
  const recurring = program.commissionType === "recurring"
  const [firstName = "", ...rest] = (user?.name ?? "").trim().split(/\s+/)
  const canApply = !!user && (!affiliate || affiliate.status === "rejected")
  const review = program.autoApprove ? "You'll get access as soon as you submit." : "Our team reviews every application by hand and gets back to you by email, usually within a few business days."

  return (
    <div className="min-h-svh bg-background">
      <AffiliateNavbar
        homeHref={urls.site}
        links={[
          { label: "Home", href: urls.site },
          { label: "Brokers", href: `${urls.site}/brokers` },
          { label: "Pricing", href: `${urls.site}/pricing` },
          { label: "Affiliates", href: urls.self, active: true },
          { label: "Help", href: urls.help },
        ]}
        signedIn={!!user}
        signInHref={urls.signIn}
        signUpHref={urls.signUp}
        appHref={urls.app}
      />

      <main>
        <AffiliateHero applyHref="#apply" tiersHref={activeTiers.length ? "#tiers" : "#apply"} />

        <AffiliateTierProgression id="tiers" tiers={activeTiers} couponPercent={program.permanentCouponPercent} recurring={recurring} />

        <AffiliateApplication
          id="apply"
          description={`Fill out the form to join our affiliate program. ${review}`}
          points={[
            { icon: "link", title: "Share your unique link", body: `Promote TradeLoop to your audience. Clicks are remembered for ${program.cookieDays} days.` },
            { icon: "earn", title: "Earn commissions", body: `${startRate}% to start${topRate > startRate ? `, up to ${topRate}%` : ""} — on ${recurring ? "every payment a customer you referred makes" : "each referred customer's first payment"}. Withdraw by ${payoutMethods} from ${money(program.minPayout)}.` },
            { icon: "grow", title: "Grow together", body: "Your tier rises automatically as your paying customers grow. We're a partner in your success." },
          ]}
        >
          <h3 className="text-lg font-semibold tracking-tight">{affiliate?.status === "rejected" ? "Apply again" : "Application Form"}</h3>

          {affiliate?.status === "pending" || affiliate?.status === "review" ? (
            <div className="mt-4">
              <StatusCard icon={Clock} title={affiliate.status === "review" ? "Your application is being reviewed" : "Application received"}>
                Thanks, {affiliate.firstName}. We review every application by hand and will email {affiliate.email} as soon as there&apos;s a decision — usually within a few business days.
              </StatusCard>
            </div>
          ) : affiliate?.status === "suspended" ? (
            <div className="mt-4">
              <StatusCard icon={ShieldAlert} title="Your affiliate account is suspended" tone="loss">
                Your links aren&apos;t tracking and the dashboard is unavailable while the account is suspended. If you think this is a mistake, contact{" "}
                <a href="mailto:support@tradeloop.pro" className="font-medium text-primary hover:underline">
                  support@tradeloop.pro
                </a>
                .
              </StatusCard>
            </div>
          ) : !user ? (
            // The application belongs to a TradeLoop account, so that comes first.
            <div className="mt-4 rounded-2xl border border-dashed bg-background/60 p-6 text-center sm:p-8">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
                <UserPlus className="size-6" aria-hidden />
              </span>
              <p className="mt-4 text-base font-semibold tracking-tight">Start with your TradeLoop account</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Your application is tied to an account, so create one (or log in) and the form opens right here. It takes about two minutes: your name and country, where you&apos;ll promote TradeLoop, and how.</p>
              <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
                <a href={urls.signUp} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40">
                  Create an account to apply <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                </a>
                <a href={urls.signIn} className="inline-flex h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">
                  I already have an account
                </a>
              </div>
            </div>
          ) : null}

          {affiliate?.status === "rejected" && (
            <div className="mt-4">
              <StatusCard icon={XCircle} title="We couldn't approve your application" tone="loss">
                {affiliate.rejectionReason ? <span className="block">{affiliate.rejectionReason}</span> : null}
                <span className="mt-1 block">You&apos;re welcome to apply again below with more detail about your audience.</span>
              </StatusCard>
            </div>
          )}

          {canApply && user && (
            <div className="mt-5">
              <ApplyForm
                email={user.email}
                termsHref={urls.terms}
                countries={countries}
                defaults={
                  affiliate
                    ? { firstName: affiliate.firstName, lastName: affiliate.lastName, country: affiliate.country ?? "", website: affiliate.website ?? "", audienceSize: affiliate.audienceSize ?? "", trafficSource: affiliate.trafficSource ?? "", promotionMethod: affiliate.promotionMethod ?? "", reason: affiliate.reason ?? "" }
                    : { firstName, lastName: rest.join(" "), country: /^[A-Z]{2}$/.test(country) ? country : "" }
                }
              />
            </div>
          )}
        </AffiliateApplication>

        <AffiliateBenefits
          items={[
            { icon: "commission", title: "Competitive Commissions", body: `Earn up to ${topRate}% of what the customers you refer pay${recurring ? ", payment after payment" : ""}.` },
            { icon: "marketing", title: "Marketing Resources", body: "Get banners, tracking links, and promotional materials." },
            { icon: "support", title: "Dedicated Affiliate Support", body: "Our team is here to help you every step of the way." },
            { icon: "trust", title: "Transparent Tracking", body: "Every click, referral and commission is visible in your dashboard as it happens." },
          ]}
        />
      </main>

      <AffiliateFooter
        homeHref={urls.site}
        links={[
          { label: "Pricing", href: `${urls.site}/pricing` },
          { label: "Help", href: urls.help },
          { label: "Program terms", href: urls.terms },
          { label: "Privacy", href: `${urls.site}/privacy` },
          { label: "Terms", href: `${urls.site}/terms` },
        ]}
      />
    </div>
  )
}
