import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Lock } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { balancesFor } from "@/lib/affiliates/commissions"
import { loadTiers } from "@/lib/affiliates/program"
import { achievements } from "@/lib/affiliates/v2/config"
import { achievementStats, getV2Config } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { AchievementBadge } from "@/components/affiliate/v2/dashboard"
import { Bar, PageFrame } from "@/components/affiliate/v2/ui"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Achievements" }

const STATE_TEXT = { unlocked: "Unlocked", in_progress: "In progress", locked: "Locked" } as const

export default async function AffiliateV2Achievements() {
  const { affiliate } = await requireAffiliate()
  if (!(await getV2Config()).features.achievements) redirect(affiliateHref("/affiliate/v2"))
  const [stats, balances, tiers] = await Promise.all([achievementStats(affiliate.id), balancesFor(affiliate.id), loadTiers()])
  const items = achievements({ ...stats, lifetimeEarned: balances.lifetimeEarned }, tiers.filter((t) => t.enabled).map((t) => ({ id: t.id, name: t.name, minCustomers: t.minCustomers, style: t.style ?? "plain" })))
  const unlocked = items.filter((a) => a.state === "unlocked").length
  const money = (v: number) => `$${Math.floor(v).toLocaleString("en-US")}`

  return (
    <PageFrame title="Achievements" description="Milestones you've reached, and the next ones.">
      <section className="v2-card-glow flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div>
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Your collection</p>
          <p className="text-2xl font-bold tracking-tight">
            {unlocked} of {items.length} unlocked
          </p>
          <p className="text-sm text-muted-foreground">Every badge comes from your real results.</p>
        </div>
        <Bar value={unlocked / Math.max(1, items.length)} label="Achievements unlocked" className="h-2.5 w-full sm:w-64" />
      </section>

      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((a) => {
          const isMoney = a.icon === "money"
          return (
            <li key={a.key} className={cn("v2-card v2-fade-up flex flex-col items-center gap-3 p-4 text-center sm:p-5", a.state === "locked" && "opacity-80")}>
              <AchievementBadge a={a} size="lg" />
              <div>
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
              </div>
              <div className="mt-auto w-full">
                <Bar value={a.progress} label={a.title} className="h-1.5" />
                <p className={cn("mt-1.5 flex items-center justify-center gap-1 text-[11px] font-semibold", a.state === "unlocked" ? "text-gain" : "text-muted-foreground")}>
                  {a.state === "locked" && <Lock className="size-3" aria-hidden />}
                  {STATE_TEXT[a.state]}
                  {a.state !== "unlocked" && <span className="font-normal tabular-nums">· {isMoney ? `${money(a.value)} / ${money(a.target)}` : `${Math.min(a.value, a.target).toLocaleString("en-US")} / ${a.target.toLocaleString("en-US")}`}</span>}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </PageFrame>
  )
}
