import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getSharedPlaybook } from "@/app/actions/playbooks"
import { getSharedTrade } from "@/app/actions/trade-share"
import { getSharedDailyPnl } from "@/app/actions/daily-pnl-share"
import { getSharedPayout } from "@/app/actions/payouts"
import { ClonePlaybookButton } from "@/components/clone-playbook-button"
import { TradePnlCard } from "@/components/trade-pnl-card"
import { DailyPnlCard } from "@/components/daily-pnl-card"
import { PayoutCertificate } from "@/components/payout-certificate"
import { Card } from "@/components/ui/card"
import { CheckCircle2, TrendingUp } from "lucide-react"

function resolveBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  )
}

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const [playbook, trade, dailyPnl, payout, session] = await Promise.all([
    getSharedPlaybook(token),
    getSharedTrade(token),
    getSharedDailyPnl(token),
    getSharedPayout(token),
    auth.api.getSession({ headers: await headers() }),
  ])

  if (trade) {
    return (
      <div className="flex min-h-svh flex-col items-center bg-gradient-to-br from-background via-background to-accent/30 p-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="size-5" />
          </div>
          <span className="text-xl font-semibold tracking-tight">TradeLoop</span>
        </div>
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared trade</p>
        <TradePnlCard
          trade={trade}
          traderName={trade.traderName}
          traderImage={trade.traderImage}
          shareUrl={`${resolveBaseUrl()}/p/${token}`}
        />
      </div>
    )
  }

  if (dailyPnl) {
    return (
      <div className="flex min-h-svh flex-col items-center bg-gradient-to-br from-background via-background to-accent/30 p-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="size-5" />
          </div>
          <span className="text-xl font-semibold tracking-tight">TradeLoop</span>
        </div>
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shared {dailyPnl.period === "weekly" ? "weekly" : "daily"} P&amp;L
        </p>
        <DailyPnlCard
          data={dailyPnl}
          traderName={dailyPnl.traderName}
          traderImage={dailyPnl.traderImage}
          isPro={dailyPnl.traderIsPro}
          shareUrl={`${resolveBaseUrl()}/p/${token}`}
          generatedAt={new Date(dailyPnl.createdAt)}
        />
      </div>
    )
  }

  if (payout) {
    return (
      <div className="flex min-h-svh flex-col items-center bg-gradient-to-br from-background via-background to-accent/30 p-4 py-10">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="size-5" />
          </div>
          <span className="text-xl font-semibold tracking-tight">TradeLoop</span>
        </div>
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shared payout certificate
        </p>
        <PayoutCertificate summary={payout} isPro={payout.traderIsPro} shareUrl={`${resolveBaseUrl()}/p/${token}`} />
      </div>
    )
  }

  if (!playbook) notFound()

  return (
    <div className="flex min-h-svh flex-col items-center bg-gradient-to-br from-background via-background to-accent/30 p-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingUp className="size-5" />
        </div>
        <span className="text-xl font-semibold tracking-tight">TradeLoop</span>
      </div>

      <div className="w-full max-w-lg">
        <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shared playbook
        </p>
        <Card className="p-6">
          <h1 className="text-xl font-semibold">{playbook.name}</h1>
          {playbook.description && <p className="mt-1 text-sm text-muted-foreground">{playbook.description}</p>}

          {playbook.rules && playbook.rules.length > 0 && (
            <ul className="mt-4 space-y-2">
              {playbook.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 border-t pt-4">
            <ClonePlaybookButton token={token} isSignedIn={!!session?.user} />
          </div>
        </Card>
      </div>
    </div>
  )
}
