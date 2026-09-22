import { notFound } from "next/navigation"
import Link from "next/link"
import { getBacktestSession } from "@/app/actions/backtest"
import { PageHeader } from "@/components/page-header"
import { Card } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { getT } from "@/lib/i18n/server"
import { ChevronLeft } from "lucide-react"

// Session shell. The interactive replay workspace (chart + controls + order
// panel) is the next phase and mounts here; for now this confirms the session
// exists and its parameters, so the create → open flow is navigable end to end.
export default async function BacktestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getT()
  const session = await getBacktestSession(Number(id))
  if (!session) notFound()

  const rows: [string, string][] = [
    [t("Market"), session.symbol],
    [t("Timeframe"), session.timeframe],
    [t("Starting balance"), `$${Number(session.startingBalance).toLocaleString()}`],
    [t("Status"), t(session.status)],
    [t("Mode"), session.randomMode ? t("Random date (hidden)") : t("Fixed date")],
  ]

  return (
    <div>
      <PageHeader
        title={session.name || session.symbol}
        description={t("Backtest session")}
        action={
          <Link href="/backtest" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="size-4" /> {t("Back")}
          </Link>
        }
      />
      <div className="p-4 sm:p-6">
        <Card className="max-w-lg gap-3 p-5">
          <dl className="divide-y">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-2 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {t("The replay chart and trading controls load here — that's the next build phase.")}
          </p>
        </Card>
      </div>
    </div>
  )
}
