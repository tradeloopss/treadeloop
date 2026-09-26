import Link from "next/link"
import { Zap, Clock, Upload, Check } from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { getT } from "@/lib/i18n/server"

export async function generateMetadata() {
  const t = await getT()
  return { title: t("Supported Brokers — TradeLoop") }
}

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
    note: "Set up today for Exness, FTMO (including its free-trial servers), FundedNext and ACG Markets (Alpha Capital). Other brokers are added as traders ask for them.",
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

export default async function BrokersPage() {
  const t = await getT()
  return (
    <div className="min-h-svh bg-gradient-to-b from-background to-accent/20 px-4 py-16">
      <div className="mx-auto mb-10 flex max-w-4xl items-center justify-center gap-2">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">TradeLoop</span>
        </Link>
      </div>

      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("Supported brokers")}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            {t("Two ways to get your trades in: connect an account and let it sync itself, or upload the file your platform already exports.")}
          </p>
        </div>

        <section className="mt-10 rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--gain)]/12 text-[var(--gain)]">
              <Zap className="size-4" />
            </span>
            <div>
              <h2 className="font-semibold">{t("Auto connection & auto sync")}</h2>
              <p className="text-xs text-muted-foreground">{t("Connect once — new trades appear on their own.")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {AUTO_SYNC.map((broker) => (
              <div key={broker.name} className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-[var(--gain)]" />
                  <h3 className="font-semibold">{broker.name}</h3>
                  <span className="ms-auto rounded-full bg-[var(--gain)]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--gain)]">
                    {t("Live")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{t(broker.detail)}</p>
                <p className="mt-2 text-xs text-muted-foreground/80">{t(broker.note)}</p>
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
              <h2 className="font-semibold">{t("Auto connection — coming soon")}</h2>
              <p className="text-xs text-muted-foreground">{t("Built and usable today by file import.")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {COMING_SOON.map((broker) => (
              <div key={broker.name} className="rounded-xl border border-dashed p-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-muted-foreground">{broker.name}</h3>
                  <span className="ms-auto rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t("Coming soon")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{t(broker.detail)}</p>
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
              <h2 className="font-semibold">{t("Every other broker — file import")}</h2>
              <p className="text-xs text-muted-foreground">{t("No login or API key needed.")}</p>
            </div>
          </div>

          <ul className="mt-5 divide-y rounded-xl border">
            {FILE_IMPORT.map((broker) => (
              <li key={broker.name} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <span className="font-medium">{broker.name}</span>
                <span className="text-sm text-muted-foreground">{t(broker.how)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-muted-foreground">
            {t("These are the export formats TradeLoop reads today. If your broker can export to one of them — most can export a Tradovate-style or NinjaTrader-style CSV — your trades will import. If yours can't, tell us at")}{" "}
            <a href="mailto:support@tradeloop.pro" className="font-medium text-primary hover:underline">
              support@tradeloop.pro
            </a>{" "}
            {t("and we'll look at adding it.")}
          </p>
        </section>

        <div className="mt-10 text-center">
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("Start your free trial")}
          </Link>
        </div>
      </div>
    </div>
  )
}
