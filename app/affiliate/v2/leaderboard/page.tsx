import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Crown, ShieldCheck, Trophy } from "lucide-react"
import { requireAffiliate } from "@/lib/affiliates/guard"
import { money, pct } from "@/lib/affiliates/types"
import { getV2Config, leaderboard, publicName, type LeaderMetric, type LeaderPeriod } from "@/lib/affiliates/v2/server"
import { affiliateHref } from "@/lib/urls"
import { LeaderboardOptIn } from "@/components/affiliate/v2/leaderboard-optin"
import { EmptyState, LinkTabs, PageFrame, V2Card } from "@/components/affiliate/v2/ui"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Leaderboard" }

const PERIODS: { key: LeaderPeriod; label: string }[] = [
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "all", label: "All Time" },
]
const METRICS: { key: LeaderMetric; label: string }[] = [
  { key: "earnings", label: "Top Earnings" },
  { key: "customers", label: "Top Referrals" },
  { key: "conversion", label: "Top Conversion" },
]
const MEDALS = ["from-[#fde047] to-[#ca8a04]", "from-[#e2e8f0] to-[#64748b]", "from-[#fdba74] to-[#b45309]"]

export default async function AffiliateV2Leaderboard({ searchParams }: { searchParams: Promise<{ period?: string; metric?: string }> }) {
  const { affiliate } = await requireAffiliate()
  if (!(await getV2Config()).features.leaderboard) redirect(affiliateHref("/affiliate/v2"))
  const sp = await searchParams
  const period = PERIODS.find((p) => p.key === sp.period)?.key ?? "month"
  const metric = METRICS.find((m) => m.key === sp.metric)?.key ?? "earnings"
  const board = await leaderboard(affiliate.id, period, metric)
  const href = (p: LeaderPeriod, m: LeaderMetric) => `/affiliate/v2/leaderboard?${new URLSearchParams(Object.entries({ period: p === "month" ? "" : p, metric: m === "earnings" ? "" : m }).filter(([, v]) => v))}`
  const value = (r: { earnings: number; customers: number; conversion: number | null }) => (metric === "earnings" ? money(r.earnings) : metric === "customers" ? `${r.customers} customer${r.customers === 1 ? "" : "s"}` : r.conversion != null ? pct(r.conversion) : "—")

  return (
    <PageFrame title="Leaderboard" description="How the affiliates who choose to appear are doing.">
      <V2Card>
        <LeaderboardOptIn on={affiliate.leaderboardPublic} name={publicName(affiliate.firstName, affiliate.lastName)} />
      </V2Card>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <LinkTabs current={period} tabs={PERIODS.map((p) => ({ key: p.key, label: p.label, href: href(p.key, metric) }))} />
        <LinkTabs current={metric} tabs={METRICS.map((m) => ({ key: m.key, label: m.label, href: href(period, m.key) }))} />
      </div>

      <V2Card title={`${METRICS.find((m) => m.key === metric)!.label} · ${PERIODS.find((p) => p.key === period)!.label}`} subtitle={metric === "conversion" ? "Customers ÷ clicks, for affiliates with at least 50 clicks in the period." : "Only affiliates who chose to appear are shown."}>
        {board.rows.length === 0 ? (
          <EmptyState icon={Trophy} title="No rankings yet">
            Nobody on the leaderboard has results in this period yet.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {board.rows.map((r) => (
              <li key={`${r.rank}-${r.name}`} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", r.you ? "border-primary/50 bg-primary/[0.08]" : "bg-background/30")} aria-current={r.you ? "true" : undefined}>
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums", r.rank <= 3 ? cn("bg-gradient-to-br text-[#0b1533]", MEDALS[r.rank - 1]) : "bg-muted text-muted-foreground")}>
                  {r.rank <= 3 ? <Crown className="size-4" aria-hidden /> : r.rank}
                  <span className="sr-only">Rank {r.rank}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 truncate text-sm font-semibold">
                    {r.name}
                    {r.you && <span className="rounded-full bg-primary px-1.5 text-[9px] font-bold text-primary-foreground uppercase">You</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    #{r.rank} · {r.customers} customer{r.customers === 1 ? "" : "s"} · {money(r.earnings)}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums">{value(r)}</span>
              </li>
            ))}
          </ol>
        )}
        {board.you && !board.rows.some((r) => r.you) && (
          <p className="mt-3 rounded-xl border border-primary/40 bg-primary/[0.06] px-3 py-2.5 text-sm">
            You&apos;re <span className="font-semibold">#{board.you.rank}</span> of {board.total} — {value(board.you)}.
          </p>
        )}
      </V2Card>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden /> Only a first name and last initial are shown, and only for affiliates who switch this on. No customer is ever shown.
      </p>
    </PageFrame>
  )
}
