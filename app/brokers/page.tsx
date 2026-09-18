import Link from "next/link"
import { TrendingUp, Zap, Clock, Upload, Check } from "lucide-react"

export const metadata = { title: "Supported Brokers — TradeLoop" }

// Only what the app actually does today. Anything not yet built is labelled
// as such rather than listed alongside the working connections.
const AUTO_SYNC = [
  {
    name: "Rithmic",
    detail: "Live connection to your Rithmic login. Fills are pulled automatically and reconstructed into trades.",
    note: "Covers the prop firms and brokers that route through Rithmic — Apex, TopStep, and others.",
  },
  {
    name: "MetaTrader 4 & 5",
    detail: "Connect with your investor (read-only) password. Closed positions and balance sync on their own.",
    note: "Works with any broker running an MT4 or MT5 server.",
  },
]

const COMING_SOON = [
  {
    name: "Tradovate",
    detail: "Direct account connection is in progress. Until it ships, import a Tradovate CSV — it takes about a minute.",
  },
]

const FILE_IMPORT = [
  { name: "Tradovate", how: "Reports → Orders → pick a date range → Download CSV" },
  { name: "NinjaTrader", how: "Control Center → Trade Performance → Trades tab → right-click → Export" },
  { name: "MetaTrader 4 / 5", how: "Terminal → Account History → right-click → Save as Report (HTML)" },
]

export default function BrokersPage() {
  return (
    <div className="min-h-svh bg-gradient-to-b from-background to-accent/20 px-4 py-16">
      <div className="mx-auto mb-10 flex max-w-4xl items-center justify-center gap-2">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">TradeLoop</span>
        </Link>
      </div>

      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Supported brokers</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Two ways to get your trades in: connect an account and let it sync itself, or upload the file your platform
            already exports.
          </p>
        </div>

        <section className="mt-10 rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--gain)]/12 text-[var(--gain)]">
              <Zap className="size-4" />
            </span>
            <div>
              <h2 className="font-semibold">Auto connection &amp; auto sync</h2>
              <p className="text-xs text-muted-foreground">Connect once — new trades appear on their own.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {AUTO_SYNC.map((broker) => (
              <div key={broker.name} className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-[var(--gain)]" />
                  <h3 className="font-semibold">{broker.name}</h3>
                  <span className="ml-auto rounded-full bg-[var(--gain)]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--gain)]">
                    Live
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{broker.detail}</p>
                <p className="mt-2 text-xs text-muted-foreground/80">{broker.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Clock className="size-4" />
            </span>
            <div>
              <h2 className="font-semibold">Auto connection — coming soon</h2>
              <p className="text-xs text-muted-foreground">Built and usable today by file import.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {COMING_SOON.map((broker) => (
              <div key={broker.name} className="rounded-xl border border-dashed p-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-muted-foreground">{broker.name}</h3>
                  <span className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Coming soon
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{broker.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="size-4" />
            </span>
            <div>
              <h2 className="font-semibold">Every other broker — file import</h2>
              <p className="text-xs text-muted-foreground">No login or API key needed.</p>
            </div>
          </div>

          <ul className="mt-5 divide-y rounded-xl border">
            {FILE_IMPORT.map((broker) => (
              <li key={broker.name} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <span className="font-medium">{broker.name}</span>
                <span className="text-sm text-muted-foreground">{broker.how}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-muted-foreground">
            These are the export formats TradeLoop reads today. If your broker can export to one of them — most can
            export a Tradovate-style or NinjaTrader-style CSV — your trades will import. If yours can&apos;t, tell us at{" "}
            <a href="mailto:support@tradeloop.pro" className="font-medium text-primary hover:underline">
              support@tradeloop.pro
            </a>{" "}
            and we&apos;ll look at adding it.
          </p>
        </section>

        <div className="mt-10 text-center">
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Start your free trial
          </Link>
        </div>
      </div>
    </div>
  )
}
