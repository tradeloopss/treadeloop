import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { CalendarClock, CheckCircle2, Medal } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { paidCustomerCount, loadTiers } from "@/lib/affiliates/program"
import { monthlyGoals } from "@/lib/affiliates/v2/config"
import { getV2Config, monthProgress } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { GoalRow, TierBadge } from "@/components/affiliate/v2/dashboard"
import { Bar, PageFrame, V2Card } from "@/components/affiliate/v2/ui"

export const metadata: Metadata = { title: "Goals & challenges" }

export default async function AffiliateV2Goals() {
  const { affiliate } = await requireAffiliate()
  const config = await getV2Config()
  if (!config.features.goals) redirect(affiliateHref("/affiliate/v2"))
  const now = new Date()
  const [month, customers, tiers] = await Promise.all([monthProgress(affiliate.id, now), paidCustomerCount(affiliate.id), loadTiers()])
  const { goal, challenges, monthLabel } = monthlyGoals(config.goals, month, now)
  const next = tiers.filter((t) => t.enabled && t.minCustomers > Math.max(customers, 1)).sort((a, b) => a.minCustomers - b.minCustomers)[0]
  const end = new Date(goal.deadline)
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000))
  const done = challenges.filter((c) => c.done).length

  return (
    <PageFrame title="Goals & challenges" description="This month's targets, measured on your real results.">
      <section className="v2-card-glow grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex items-center gap-4">
          <TierBadge style="gold" className="size-14" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">{goal.title}</p>
            <p className="text-xl font-bold tracking-tight">{goal.description}</p>
            <Bar value={goal.progress} label={goal.title} className="mt-3 h-2.5" />
            <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
              {goal.value} / {goal.target} · {Math.round(goal.progress * 100)}%
            </p>
          </div>
        </div>
        <div className="flex gap-3 lg:flex-col">
          <p className="flex items-center gap-2 rounded-xl border bg-background/40 px-3 py-2 text-sm">
            <CalendarClock className="size-4 text-primary" aria-hidden /> {daysLeft} day{daysLeft === 1 ? "" : "s"} left in {monthLabel}
          </p>
          <p className="flex items-center gap-2 rounded-xl border bg-background/40 px-3 py-2 text-sm">
            <CheckCircle2 className="size-4 text-gain" aria-hidden /> {done} of {challenges.length} challenges done
          </p>
        </div>
      </section>

      <V2Card title="Active challenges" subtitle={`They reset on the 1st. Progress counts what happened in ${monthLabel} (UTC).`}>
        <div className="grid gap-3 md:grid-cols-3">
          {challenges.map((c) => (
            <GoalRow key={c.key} g={c} />
          ))}
        </div>
      </V2Card>

      {next && (
        <V2Card title="Your next tier" subtitle="A goal that never resets.">
          <div className="flex items-center gap-3">
            <TierBadge style={next.style ?? "plain"} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Reach {next.name}: {next.minCustomers} paying customers
              </p>
              <Bar value={customers / next.minCustomers} label={`Progress to ${next.name}`} className="mt-2 h-1.5" />
            </div>
            <span className="text-sm font-semibold tabular-nums">
              {customers}/{next.minCustomers}
            </span>
          </div>
        </V2Card>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Medal className="size-3.5" aria-hidden /> Targets are set by the TradeLoop affiliate program; your progress comes straight from your results.
      </p>
    </PageFrame>
  )
}
