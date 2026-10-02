import type { Metadata } from "next"
import { Download } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor, releaseHolds } from "@/lib/affiliates/commissions"
import { countryOptions } from "@/lib/affiliates/countries"
import { FREQUENCY_LABELS, methodMinimum, nextPeriodStart, payoutInFlight, type AutoSkip } from "@/lib/affiliates/payout-engine"
import { autoPayoutPreview, syncStripeMethods, trackPayouts } from "@/lib/affiliates/payouts"
import { getProgram } from "@/lib/affiliates/program"
import { CRYPTO_METHOD_TYPES, cryptoSpec } from "@/lib/affiliates/crypto"
import { assetPriceUsd } from "@/lib/affiliates/kucoin"
import { autoSenderFor, methodAvailable } from "@/lib/affiliates/providers"
import { payoutMethodsFor, payoutsFor } from "@/lib/affiliates/queries"
import { money } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { Kpi, KpiGrid, linkButtonClass } from "@/components/affiliate/ui"
import { AddPayoutMethodButton, AutoPayoutPanel, MethodCards, PayoutHistory, RequestPayout, type MethodDialogConfig } from "@/components/affiliate/payouts"
import type { MethodMin } from "@/components/affiliate/request-payout-dialog"
import { affiliateHref } from "@/lib/urls"

export const metadata: Metadata = { title: "Payouts" }

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC"

export default async function AffiliatePayoutsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { affiliate } = await requireAffiliate()
  const sp = await searchParams
  // Bring everything up to date before reading it: commissions whose hold has
  // passed, payouts whose transaction may have confirmed, and (after coming
  // back from Stripe's onboarding) the state of the connected account.
  await Promise.all([
    releaseHolds({ affiliateId: affiliate.id }),
    trackPayouts({ affiliateId: affiliate.id, olderThanSeconds: 30, limit: 2 }).catch(() => null),
    methodAvailable("stripe") ? syncStripeMethods(affiliate.id) : Promise.resolve(),
  ])
  const [balances, methods, payouts, program, preview] = await Promise.all([balancesFor(affiliate.id), payoutMethodsFor(affiliate.id), payoutsFor(affiliate.id), getProgram(), autoPayoutPreview(affiliate.id)])
  if (!preview) return null
  const { settings, limits, decision } = preview
  const inProgress = payouts.some((p) => payoutInFlight(p.status))

  // The same checks the server enforces when a request is submitted
  // (payout-engine.manualPayoutProblem) — shown up front so the button explains itself.
  const blocked = settings.paused
    ? "Payouts are temporarily paused. Your balance is safe — please try again later."
    : affiliate.fraudLock
      ? "Payouts are paused while your account is under review."
      : affiliate.payoutHold
        ? "Payouts are on hold for your account. Contact affiliate support."
        : !affiliate.manualPayoutAllowed
          ? "Payout requests are switched off for your account. Contact affiliate support."
          : inProgress
            ? "You have a payout in progress. You can request another once it's complete."
            : null

  const SKIP: Record<AutoSkip, string> = {
    paused: "Paused for now",
    auto_off: "Not running right now",
    affiliate_inactive: "Unavailable",
    admin_disabled: "Disabled for your account",
    opted_out: "Switch automatic payouts on",
    fraud_hold: "On hold during a review",
    payout_hold: "On hold for your account",
    risk_review: "On hold during a review",
    no_method: "Add a default payout method",
    method_ineligible: "Your default method isn't active",
    method_hold: preview.method?.holdUntil ? `After ${when(preview.method.holdUntil)}` : "After the security hold",
    in_flight: "After your current payout completes",
    already_paid_this_period: `From ${when(nextPeriodStart(settings.frequency, new Date()))}`,
    below_threshold: `When your balance reaches ${money(preview.threshold)}`,
    price_unavailable: "On the next run",
    limit_reached: "Later — the program's payout limit was reached",
  }

  const offered = settings.methods.filter((m) => methodAvailable(m))
  const config: MethodDialogConfig = { methods: offered, countries: countryOptions(), defaultCountry: affiliate.country ?? "", holdHours: settings.methodHoldHours, hasMethod: methods.length > 0 }
  const methodViews = methods.map((m) => ({ id: m.id, type: m.type, label: m.label, nickname: m.nickname, status: m.status, isDefault: m.isDefault, holdUntil: m.holdUntil ? m.holdUntil.toISOString() : null, metadata: m.metadata }))
  const autoOn = affiliate.autoPayout && affiliate.autoPayoutAllowed
  // Which crypto methods something is set up to send without review, and — for
  // an asset that isn't dollar-pegged — its price, for an estimate in the dialog.
  const instantTypes = settings.cryptoAutoSend && !settings.paused ? CRYPTO_METHOD_TYPES.filter((t) => autoSenderFor(t)) : []
  const prices: Record<string, number> = {}
  for (const asset of new Set(methods.map((m) => cryptoSpec(m.type)).filter((c) => c && !c.usdPegged).map((c) => c!.asset))) {
    const price = await Promise.race([assetPriceUsd(asset).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))])
    if (price) prices[asset] = price
  }
  // Each method's own minimum, for the methods this affiliate has. The server
  // applies the same rule when the request is made (payout-engine.effectiveLimits).
  const methodMins: Record<string, MethodMin> = {}
  for (const type of new Set(methods.map((m) => m.type))) {
    const floor = methodMinimum(type, settings, prices)
    if (floor) methodMins[type] = { text: floor.text, usd: floor.usd, title: floor.title }
  }

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Manage your payout methods and withdraw your affiliate earnings."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {payouts.length > 0 && (
              <a href={affiliateHref("/affiliate/export/payouts")} className={linkButtonClass}>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            )}
            <AddPayoutMethodButton config={config} />
          </div>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {sp.stripe === "return" && methods.some((m) => m.type === "stripe") && (
          <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
            {methods.find((m) => m.type === "stripe")!.status === "active" ? "Your Stripe account is connected and ready to receive payouts." : "Stripe hasn't finished verifying your account yet. Its status below updates as soon as it does — use Verify to continue if Stripe needs more from you."}
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <section className="rounded-xl border bg-card p-5 lg:col-span-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Available to withdraw</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{money(balances.available)}</p>
            <div className="mt-4">
              <RequestPayout
                available={balances.available}
                pendingBalance={balances.pending}
                min={limits.min}
                max={limits.max}
                methodMins={methodMins}
                methods={methodViews}
                blocked={blocked}
                eta={program.payoutEta}
                feePolicy={settings.feePolicy}
                fees={settings.fees}
                approval={settings.approval}
                instantUpTo={instantTypes.length ? settings.cryptoAutoMax : null}
                instantTypes={instantTypes}
                prices={prices}
                autoPayoutOn={autoOn && settings.autoPayouts && !settings.paused}
                methodConfig={config}
              />
            </div>
          </section>
          <KpiGrid className="lg:col-span-2">
            <Kpi label="Pending" value={money(balances.pending)} note={`Clears after the ${program.holdDays}-day hold`} />
            <Kpi label="Processing" value={money(balances.processing)} note={inProgress ? "A payout is on its way" : "None right now"} />
            <Kpi label="Lifetime earned" value={money(balances.lifetimeEarned)} note="All time" />
            <Kpi label="Lifetime paid" value={money(balances.lifetimePaid)} note="All time" />
          </KpiGrid>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Payout methods</h2>
          <MethodCards methods={methodViews} config={config} autoPayoutOn={autoOn} />
        </section>

        <AutoPayoutPanel
          auto={{
            enabled: affiliate.autoPayout,
            allowed: affiliate.autoPayoutAllowed,
            programOn: settings.autoPayouts,
            paused: settings.paused,
            threshold: preview.threshold,
            min: limits.min,
            max: limits.max,
            frequency: FREQUENCY_LABELS[settings.frequency],
            method: preview.method ? { type: preview.method.type, label: preview.method.label } : null,
            status: decision.ok ? `Ready — ${money(decision.amount)} in the next run` : SKIP[decision.code],
            ready: decision.ok,
          }}
        />

        <section id="payout-history" className="flex scroll-mt-4 flex-col gap-3">
          <h2 className="text-sm font-semibold">Payout history</h2>
          <PayoutHistory
            payouts={payouts.map((p) => ({ id: p.id, amount: p.amount, fee: p.fee, net: p.net, methodType: p.methodType, methodLabel: p.methodLabel, status: p.status, mode: p.mode, network: p.network, asset: p.asset, transactionHash: p.transactionHash, failureReason: p.failureReason, requestedAt: p.requestedAt.toISOString(), completedAt: p.completedAt ? p.completedAt.toISOString() : null }))}
          />
        </section>
      </div>
    </div>
  )
}
