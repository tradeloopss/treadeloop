import type { ProgramSettings } from "@/lib/affiliates/types"
import { money } from "@/lib/affiliates/types"

// The program terms an applicant agrees to. The numbers are read from the live
// program settings, so the page always states what the system actually does.
// `startRate` — what the first tier pays; `scheduled` — some tier pays one rate
// for a customer's first months and another afterwards.
export function ProgramTerms({ program, startRate = program.defaultRate, scheduled = false }: { program: ProgramSettings; startRate?: number; scheduled?: boolean }) {
  const earning =
    program.commissionType === "one_time"
      ? "a commission on each referred customer's first subscription payment"
      : program.durationMonths
        ? `a commission on every subscription payment a referred customer makes during their first ${program.durationMonths} months`
        : "a commission on every subscription payment a referred customer makes, for as long as they stay subscribed"
  const terms: [string, string][] = [
    ["Commissions", `You earn ${earning}. It's calculated on the amount the customer actually pays, after discounts and excluding tax. Rates start at ${startRate}% and can rise with the number of paying customers you refer.${scheduled ? " A higher tier pays its rate for a customer's first months and a lower one from then on; the tiers above state exactly what each pays. The tier you are in when a payment is made decides its rate." : ""}`],
    ["Attribution", `A visitor who opens your link and creates a new TradeLoop account within ${program.cookieDays} days is your referral. ${program.attribution === "first_touch" ? "When more than one affiliate link was clicked, the first click counts." : "When more than one affiliate link was clicked, the most recent click counts."} A customer who pays with your coupon code and wasn't referred by a link is credited to you as well. People who already had an account are not referrals.`],
    ["Holding period and reversals", `Each commission is held for ${program.holdDays} days. ${program.refundReversal ? "If the payment is refunded the commission is reversed (proportionally for a partial refund); a chargeback always reverses it." : "A chargeback on the payment reverses the commission."} If a commission that was already paid out is later reversed, the amount is deducted from your balance.`],
    ["Payouts", `You can request a payout once ${money(program.minPayout)} or more is available. Requests are reviewed by our team and usually arrive within ${program.payoutEta}. You're responsible for any taxes on what you earn.`],
    ["Not allowed", "Referring yourself or accounts you control; fake, incentivised or bulk sign-ups; spam of any kind; bidding on TradeLoop brand terms in paid search; impersonating TradeLoop; and misleading claims about the product or about trading results."],
    ["Enforcement", "We review unusual activity by hand. Accounts that break these terms can be suspended, and commissions earned by breaking them can be reversed. We may change or end the program; commissions already earned under the previous terms stay yours."],
  ]
  return (
    <dl className="space-y-4">
      {terms.map(([title, body]) => (
        <div key={title}>
          <dt className="text-sm font-medium">{title}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</dd>
        </div>
      ))}
    </dl>
  )
}
