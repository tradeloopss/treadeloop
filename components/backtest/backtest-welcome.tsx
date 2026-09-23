import Link from "next/link"
import { Card } from "@/components/ui/card"
import { getT } from "@/lib/i18n/server"
import { Plus, Trophy, Rewind, CandlestickChart, NotebookPen, BarChart3 } from "lucide-react"

// The Backtesting dashboard's empty state — shown when the trader has no
// sessions yet. Mirrors the "choose how to test" welcome: pick a session type,
// then a quick "how to get started".
export async function BacktestWelcome() {
  const t = await getT()

  const steps: { icon: typeof Rewind; title: string; text: string }[] = [
    { icon: CandlestickChart, title: t("Create a session"), text: t("Pick a market, timeframe and starting balance.") },
    { icon: Rewind, title: t("Replay the market"), text: t("Step candle by candle and place simulated trades.") },
    { icon: NotebookPen, title: t("Journal your trades"), text: t("Every trade lands in your journal to study later.") },
    { icon: BarChart3, title: t("Analyze results"), text: t("Win rate, profit factor, expectancy and equity curve.") },
  ]

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("Welcome to Backtesting")}</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          {t("Choose how you want to test your strategy — by building data, or testing under prop firm rules.")}
        </p>
      </div>

      <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
        <Link
          href="/backtest/sessions"
          className="group flex items-start gap-3 rounded-2xl border border-primary/50 bg-primary/[0.04] p-5 transition-colors hover:border-primary hover:bg-accent/40"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plus className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{t("Backtesting session")}</span>
            <span className="block text-sm text-muted-foreground">{t("Build data to refine your strategy.")}</span>
          </span>
        </Link>

        <Link
          href="/backtest/sessions"
          className="group flex items-start gap-3 rounded-2xl border p-5 transition-colors hover:border-primary hover:bg-accent/40"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Trophy className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold">
              {t("Prop firm session")}
              <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">{t("Soon")}</span>
            </span>
            <span className="block text-sm text-muted-foreground">{t("Test your strategy against prop firm rules.")}</span>
          </span>
        </Link>
      </div>

      <p className="mt-12 text-center text-sm font-medium text-muted-foreground">{t("Here's how to get started")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => {
          const Icon = s.icon
          return (
            <Card key={i} className="gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>
              </div>
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.text}</div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
