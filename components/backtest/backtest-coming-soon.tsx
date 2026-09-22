import { PageHeader } from "@/components/page-header"
import { Card } from "@/components/ui/card"
import { getT } from "@/lib/i18n/server"
import { CandlestickChart, Rewind, NotebookPen, Trophy } from "lucide-react"

// Shown to non-admins while the backtester is still being built. Admins get the
// real feature (gated in the page via getAdmin()).
export async function BacktestComingSoon() {
  const t = await getT()
  const points: { icon: typeof Rewind; text: string }[] = [
    { icon: Rewind, text: t("Replay any market candle by candle — no look-ahead, just like live.") },
    { icon: CandlestickChart, text: t("Place simulated trades with SL/TP and risk-based sizing.") },
    { icon: NotebookPen, text: t("Every backtested trade lands in your journal automatically.") },
    { icon: Trophy, text: t("Full results — win rate, profit factor, expectancy, equity curve.") },
  ]
  return (
    <div>
      <PageHeader title={t("Backtesting")} description={t("Practice and refine your edge on historical data.")} />
      <div className="p-4 sm:p-6">
        <Card className="max-w-xl gap-5 p-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-foreground text-background">
            <CandlestickChart className="size-6" />
          </div>
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("Coming soon")}
            </div>
            <h2 className="text-lg font-semibold">{t("A full replay backtester, inside TradeLoop")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("We're putting the finishing touches on it. Here's what's on the way:")}
            </p>
          </div>
          <ul className="space-y-2.5 text-start">
            {points.map((p, i) => {
              const Icon = p.icon
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{p.text}</span>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
