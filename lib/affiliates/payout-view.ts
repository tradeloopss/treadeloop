import { balancesFor, releaseHolds } from "./commissions"
import { countryOptions } from "./countries"
import { FREQUENCY_LABELS, methodMinimum, nextPeriodStart, payoutInFlight, type AutoSkip } from "./payout-engine"
import { autoPayoutPreview, syncStripeMethods, trackPayouts } from "./payouts"
import { getProgram } from "./program"
import { CRYPTO_METHOD_TYPES, cryptoSpec } from "./crypto"
import { assetPriceUsd } from "./kucoin"
import { autoSenderFor, methodAvailable } from "./providers"
import { payoutMethodsFor, payoutsFor } from "./queries"
import { money, type PayoutMethodType } from "./types"
import type { PortalContext } from "./guard"

// Everything a page that shows balances and lets the affiliate withdraw needs
// (Classic Payouts, V2 Wallet and Payouts) — prepared on the server, the same
// way for all of them. The checks shown here are the ones the server enforces
// again when a payout is actually requested (payouts.createPayout).

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC"

export type PayoutPageData = NonNullable<Awaited<ReturnType<typeof loadPayoutPage>>>

export async function loadPayoutPage(affiliate: PortalContext["affiliate"], opts: { syncStripe?: boolean } = {}) {
  // Bring everything up to date before reading it: commissions whose hold has
  // passed, payouts whose transaction may have confirmed, and (after coming
  // back from Stripe's onboarding) the state of the connected account.
  await Promise.all([
    releaseHolds({ affiliateId: affiliate.id }),
    trackPayouts({ affiliateId: affiliate.id, olderThanSeconds: 30, limit: 2 }).catch(() => null),
    opts.syncStripe !== false && methodAvailable("stripe") ? syncStripeMethods(affiliate.id) : Promise.resolve(),
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

  const offered = settings.methods.filter((m) => methodAvailable(m)) as PayoutMethodType[]
  const config = { methods: offered, countries: countryOptions(), defaultCountry: affiliate.country ?? "", holdHours: settings.methodHoldHours, hasMethod: methods.length > 0 }
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
  const methodMins: Record<string, { text: string; usd: number | null; title: string }> = {}
  for (const type of new Set(methods.map((m) => m.type))) {
    const floor = methodMinimum(type, settings, prices)
    if (floor) methodMins[type] = { text: floor.text, usd: floor.usd, title: floor.title }
  }

  return {
    balances,
    methods,
    methodViews,
    payouts,
    payoutViews: payouts.map((p) => ({ id: p.id, amount: p.amount, fee: p.fee, net: p.net, methodType: p.methodType, methodLabel: p.methodLabel, status: p.status, mode: p.mode, network: p.network, asset: p.asset, transactionHash: p.transactionHash, failureReason: p.failureReason, requestedAt: p.requestedAt.toISOString(), completedAt: p.completedAt ? p.completedAt.toISOString() : null })),
    program,
    preview,
    settings,
    limits,
    inProgress,
    blocked,
    config,
    autoOn,
    instantTypes,
    prices,
    methodMins,
    // The props the Request Payout window takes.
    request: {
      available: balances.available,
      pendingBalance: balances.pending,
      min: limits.min,
      max: limits.max,
      methodMins,
      methods: methodViews,
      blocked,
      eta: program.payoutEta,
      feePolicy: settings.feePolicy,
      fees: settings.fees,
      approval: settings.approval,
      instantUpTo: instantTypes.length ? settings.cryptoAutoMax : null,
      instantTypes,
      prices,
      autoPayoutOn: autoOn && settings.autoPayouts && !settings.paused,
      methodConfig: config,
    },
    auto: {
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
    },
    // What the automatic payout worker will send on its next run (every few minutes), if anything.
    nextRun: decision.ok ? { amount: decision.amount } : null,
  }
}
