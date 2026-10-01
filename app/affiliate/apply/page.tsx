import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { CircleDollarSign, Clock, Link2, MailCheck, ShieldAlert, XCircle } from "lucide-react"
import { getSessionUser } from "@/lib/affiliates/guard"
import { countryOptions } from "@/lib/affiliates/countries"
import { getPayoutSettings, getProgram, loadTiers } from "@/lib/affiliates/program"
import { methodAvailable } from "@/lib/affiliates/providers"
import { getAffiliateByUser } from "@/lib/affiliates/queries"
import { methodList, money } from "@/lib/affiliates/types"
import { BrandMark } from "@/components/brand-mark"
import { ApplyForm } from "@/components/affiliate/apply-form"
import { ProgramTerms } from "@/components/affiliate/program-terms"

// The one public page of the program — what it is, what it pays, and the
// application. Indexable (the rest of /affiliate is not).
export async function generateMetadata(): Promise<Metadata> {
  const program = await getProgram()
  const title = "Affiliate Program"
  const description = `Earn ${program.defaultRate}% ${program.commissionType === "recurring" ? "recurring " : ""}commission for every trader you refer to TradeLoop, the trading journal and analytics platform. ${program.cookieDays}-day tracking, real-time dashboard, payouts from ${money(program.minPayout)}.`
  return { title, description, robots: { index: true, follow: true }, alternates: { canonical: "/affiliate/apply" }, openGraph: { title: `${title} — TradeLoop`, description, type: "website" } }
}

function StatusCard({ icon: Icon, title, children, tone = "muted" }: { icon: typeof Clock; title: string; children: React.ReactNode; tone?: "muted" | "loss" }) {
  return (
    <section className="rounded-xl border bg-card p-6 text-center sm:p-10" role="status">
      <span className={`mx-auto flex size-12 items-center justify-center rounded-full ${tone === "loss" ? "bg-[var(--loss)]/12 text-[var(--loss)]" : "bg-primary/12 text-primary"}`}>
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export default async function AffiliateApplyPage() {
  const user = await getSessionUser()
  const affiliate = user ? await getAffiliateByUser(user.id) : null
  if (affiliate?.status === "approved") redirect(affiliate.onboardedAt ? "/affiliate" : "/affiliate/onboarding")

  const [program, tiers, payoutSettings] = await Promise.all([getProgram(), loadTiers(), getPayoutSettings()])
  const payoutMethods = methodList(payoutSettings.methods.filter(methodAvailable))
  const country = (await headers()).get("x-vercel-ip-country") ?? ""
  const activeTiers = tiers.filter((t) => t.enabled).sort((a, b) => a.minCustomers - b.minCustomers)
  const topRate = Math.max(program.defaultRate, ...activeTiers.map((t) => t.ratePercent))
  const [firstName = "", ...rest] = (user?.name ?? "").trim().split(/\s+/)
  const canApply = !!user && (!affiliate || affiliate.status === "rejected")

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="font-semibold tracking-tight">TradeLoop</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Affiliates</span>
          </Link>
          {user ? (
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Back to app
            </Link>
          ) : (
            <Link href="/sign-in?next=/affiliate/apply" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <section>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Earn up to {topRate}% {program.commissionType === "recurring" ? "recurring commission" : "commission"} referring traders to TradeLoop
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Share your link. When a trader you referred subscribes, you earn a share of {program.commissionType === "recurring" ? (program.durationMonths ? `every payment for their first ${program.durationMonths} months` : "every payment they make") : "their first payment"} — tracked in a real-time dashboard and paid out from {money(program.minPayout)}.
          </p>
          {!user && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/sign-up?next=/affiliate/apply" className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                Create an account to apply
              </Link>
              <Link href="/sign-in?next=/affiliate/apply" className="inline-flex h-10 items-center rounded-lg border px-5 text-sm font-medium hover:bg-muted">
                I already have an account
              </Link>
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-3" aria-label="How it works">
          {[
            { icon: Link2, title: "1. Share your link", body: `Get a personal link and coupon code. Clicks are remembered for ${program.cookieDays} days.` },
            { icon: CircleDollarSign, title: "2. Earn on every payment", body: `${program.defaultRate}% to start, rising with the paying customers you bring in.` },
            { icon: MailCheck, title: "3. Get paid", body: `Commissions clear after ${program.holdDays} days. Withdraw by ${payoutMethods}.` },
          ].map((s) => (
            <div key={s.title} className="rounded-xl border bg-card p-5">
              <s.icon className="size-5 text-primary" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </section>

        {activeTiers.length > 0 && (
          <section className="rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Commission tiers</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Your rate moves up automatically as your paying customers grow.</p>
            </div>
            <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
              {activeTiers.map((t) => (
                <div key={t.id} className="px-5 py-4">
                  <p className="text-xs text-muted-foreground">{t.name}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{t.ratePercent}%</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.minCustomers === 0 ? "From your first customer" : `${t.minCustomers}+ paying customers`}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {affiliate?.status === "pending" || affiliate?.status === "review" ? (
          <StatusCard icon={Clock} title={affiliate.status === "review" ? "Your application is being reviewed" : "Application received"}>
            Thanks, {affiliate.firstName}. We review every application by hand and will email {affiliate.email} as soon as there&apos;s a decision — usually within a few business days.
          </StatusCard>
        ) : affiliate?.status === "suspended" ? (
          <StatusCard icon={ShieldAlert} title="Your affiliate account is suspended" tone="loss">
            Your links aren&apos;t tracking and the dashboard is unavailable while the account is suspended. If you think this is a mistake, contact{" "}
            <a href="mailto:support@tradeloop.pro" className="font-medium text-primary hover:underline">
              support@tradeloop.pro
            </a>
            .
          </StatusCard>
        ) : affiliate?.status === "rejected" ? (
          <StatusCard icon={XCircle} title="We couldn't approve your application" tone="loss">
            {affiliate.rejectionReason ? <span className="block">{affiliate.rejectionReason}</span> : null}
            <span className="mt-1 block">You&apos;re welcome to apply again below with more detail about your audience.</span>
          </StatusCard>
        ) : null}

        {canApply && user && (
          <section className="rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">{affiliate ? "Apply again" : "Apply to the program"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{program.autoApprove ? "You'll get access as soon as you submit." : "Takes about two minutes. We review applications within a few business days."}</p>
            </div>
            <div className="p-5">
              <ApplyForm
                email={user.email}
                countries={countryOptions()}
                defaults={
                  affiliate
                    ? { firstName: affiliate.firstName, lastName: affiliate.lastName, country: affiliate.country ?? "", website: affiliate.website ?? "", audienceSize: affiliate.audienceSize ?? "", trafficSource: affiliate.trafficSource ?? "", promotionMethod: affiliate.promotionMethod ?? "", reason: affiliate.reason ?? "" }
                    : { firstName, lastName: rest.join(" "), country: /^[A-Z]{2}$/.test(country) ? country : "" }
                }
              />
            </div>
          </section>
        )}

        <section id="terms" className="scroll-mt-6 rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Program terms</h2>
          </div>
          <div className="p-5">
            <ProgramTerms program={program} />
          </div>
        </section>
      </main>
    </div>
  )
}
