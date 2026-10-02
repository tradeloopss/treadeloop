import type { Metadata } from "next"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { tierHasPerk } from "@/lib/affiliates/engine"
import { affiliateTier, currentRule, getProgram } from "@/lib/affiliates/program"
import { money } from "@/lib/affiliates/types"
import { PageHeader } from "@/components/page-header"
import { Panel } from "@/components/admin/ui"
import { AffiliateSupportForm } from "@/components/affiliate/support-form"
import { appHref } from "@/lib/urls"

export const metadata: Metadata = { title: "Support" }

export default async function AffiliateSupportPage() {
  const { affiliate } = await requireAffiliate()
  const [program, rule, tier] = await Promise.all([getProgram(), currentRule(affiliate.id), affiliateTier(affiliate.id)])
  const duration = program.commissionType === "one_time" ? "the customer's first payment only" : rule.durationMonths ? `every payment a customer makes in their first ${rule.durationMonths} months` : "every payment a customer makes, for as long as they stay subscribed"
  // A tier that pays one rate for a customer's first months and another after.
  const scheduled = rule.source === "tier" && rule.tier?.introMonths != null && program.commissionType !== "one_time" ? rule.tier : null
  const earn = scheduled
    ? `Right now you're on the ${scheduled.name} tier: ${scheduled.ratePercent}% of every payment a customer makes in their first ${scheduled.introMonths} months${scheduled.afterPercent ? `, then ${scheduled.afterPercent}% of every payment for as long as they stay subscribed` : ""}.`
    : `Right now you earn ${rule.ratePercent}% of ${duration}.`

  // Answers come from the live program settings, so they can't drift from
  // what the system actually does.
  const faq: [string, string][] = [
    ["How much do I earn?", `${earn} Commission is calculated on what the customer actually pays, after discounts and before tax. Your rate can go up as you bring in more paying customers.`],
    ["How does tracking work?", `When someone opens your link, we remember it for ${program.cookieDays} days. If they create a TradeLoop account within that time, they're your referral — and stay yours. ${program.attribution === "first_touch" ? "If they clicked more than one affiliate's link, the first one they clicked gets the referral." : "If they clicked more than one affiliate's link, the most recent one gets the referral."}`],
    ["A referral is missing. Why?", "The most common reasons: they already had a TradeLoop account before clicking, they signed up after the tracking window ended, they used a different browser or device than the one they clicked on, or their browser blocked the cookie. A coupon code is a good backup — a customer who pays with your code is credited to you even without a click."],
    ["When does a commission become available?", `Each commission is pending for ${program.holdDays} days after the customer's payment. If the payment isn't refunded in that time, the commission becomes available to withdraw.`],
    ["What happens if a customer gets a refund?", program.refundReversal ? "The commission for that payment is reversed — fully for a full refund, proportionally for a partial one. You'll see the reversal as its own line in your earnings; nothing is deleted. A chargeback always reverses the commission." : "A chargeback reverses the commission for that payment. You'll see the reversal as its own line in your earnings."],
    ["How do I get paid?", `Add a payout method on the Payouts page, then request a payout once you have at least ${money(program.minPayout)} available. Our team reviews each request and sends it — usually ${program.payoutEta}. One payout can be in progress at a time.`],
    ["Can I refer myself or use my own coupon?", "No. Your own account and accounts on your own email address aren't counted as referrals, and your own coupon gives you a discount but no commission."],
    ["What am I not allowed to do?", "No bidding on TradeLoop brand keywords in paid search, no spam, no misleading claims about the product or about trading results, and no fake or incentivised sign-ups. Accounts that break these rules can be suspended and their commissions reversed."],
  ]

  return (
    <div>
      <PageHeader title="Support" description="Answers to common questions, and a direct line to the affiliate team." />
      <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-5">
        <Panel title="Frequently asked questions" className="xl:col-span-3">
          <div className="divide-y">
            {faq.map(([q, a]) => (
              <details key={q} className="group py-3 first:pt-0 last:pb-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </Panel>
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Panel title="Contact the affiliate team" description="Goes to the same support inbox as the rest of TradeLoop.">
            <AffiliateSupportForm priority={tierHasPerk(tier, "prioritySupport")} />
          </Panel>
          <Panel title="Your requests">
            <p className="text-sm text-muted-foreground">
              Replies arrive by email and in{" "}
              <Link href={appHref("/support")} className="font-medium text-primary hover:underline">
                your support requests
              </Link>
              .
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
