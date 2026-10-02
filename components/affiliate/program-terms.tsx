import { tierRateText, type TierRow } from "@/lib/affiliates/engine"
import type { ProgramSettings } from "@/lib/affiliates/types"
import { money } from "@/lib/affiliates/types"

// The program terms an applicant agrees to (the page at /affiliate/terms). The
// numbers are read from the live program settings and tiers, so the terms
// always state what the system actually does.
export function ProgramTerms({ program, tiers = [] }: { program: ProgramSettings; tiers?: TierRow[] }) {
  const ladder = tiers.filter((t) => t.enabled).sort((a, b) => a.minCustomers - b.minCustomers || a.id - b.id)
  // With tiers, what the program pays is what the tiers pay; the default rate only applies without them.
  const startRate = ladder.length ? ladder[0].ratePercent : program.defaultRate
  // some tier pays one rate for a customer's first months and another afterwards
  const scheduled = ladder.some((t) => t.introMonths != null)
  const earning =
    program.commissionType === "one_time"
      ? "a commission on each referred customer's first subscription payment"
      : program.durationMonths
        ? `a commission on every subscription payment a referred customer makes during their first ${program.durationMonths} months`
        : "a commission on every subscription payment a referred customer makes, for as long as they stay subscribed"
  const terms: [string, React.ReactNode][] = [
    ["Commissions", `You earn ${earning}. It's calculated on the amount the customer actually pays, after discounts and excluding tax. Rates start at ${startRate}% and can rise with the number of paying customers you refer.${scheduled ? " A higher tier pays its rate for a customer's first months and a lower one from then on. The tier you are in when a payment is made decides its rate." : ""}`],
    ...(ladder.length
      ? ([
          [
            "Tiers",
            <>
              Your tier is assigned automatically from the number of paying customers you have referred; it isn&apos;t chosen or paid for.
              <ul className="mt-2 space-y-1">
                {ladder.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium text-foreground">{t.name}</span> — from {Math.max(1, t.minCustomers).toLocaleString("en-US")} paying customer{Math.max(1, t.minCustomers) === 1 ? "" : "s"}: {tierRateText(t)}
                    {t.introMonths != null && t.afterPercent ? " for as long as the customer stays subscribed" : ""}.
                  </li>
                ))}
              </ul>
            </>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ["Attribution", `A visitor who opens your link and creates a new TradeLoop account within ${program.cookieDays} days is your referral. ${program.attribution === "first_touch" ? "When more than one affiliate link was clicked, the first click counts." : "When more than one affiliate link was clicked, the most recent click counts."} A customer who pays with your coupon code and wasn't referred by a link is credited to you as well. People who already had an account are not referrals.`],
    ["Holding period and reversals", `Each commission is held for ${program.holdDays} days. ${program.refundReversal ? "If the payment is refunded the commission is reversed (proportionally for a partial refund); a chargeback always reverses it." : "A chargeback on the payment reverses the commission."} If a commission that was already paid out is later reversed, the amount is deducted from your balance.`],
    ["Payouts", `You can request a payout once ${money(program.minPayout)} or more is available. Requests are reviewed by our team and usually arrive within ${program.payoutEta}. You're responsible for any taxes on what you earn.`],
    ["Not allowed", "Referring yourself or accounts you control; fake, incentivised or bulk sign-ups; spam of any kind; bidding on TradeLoop brand terms in paid search; impersonating TradeLoop; and misleading claims about the product or about trading results."],
    ["Enforcement", "We review unusual activity by hand. Accounts that break these terms can be suspended, and commissions earned by breaking them can be reversed. We may change or end the program; commissions already earned under the previous terms stay yours."],
  ]
  return (
    <dl className="space-y-5">
      {terms.map(([title, body]) => (
        <div key={title}>
          <dt className="text-sm font-semibold">{title}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</dd>
        </div>
      ))}
    </dl>
  )
}
