"use client"

import type React from "react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { BrokerImport } from "@/components/broker-import"
import { MetaTraderConnect, type Connection } from "@/components/metatrader-connect"
import { RithmicConnect, type RithmicConnection } from "@/components/rithmic-connect"
import { TradingViewConnect } from "@/components/tradingview-connect"
import type { TradingViewConnectionView, TradingViewPairingView } from "@/app/actions/tradingview"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import { Star, Search, Check, Info } from "lucide-react"
import { useT } from "@/components/locale-provider"

type Platform = "rithmic" | "tradingview" | "metatrader" | "other"

function PlatformCard({
  active,
  onClick,
  logo,
  logoClassName,
  activeClassName,
  name,
  recommended,
  comingSoon,
  paperOnly,
  description,
}: {
  active: boolean
  onClick: () => void
  logo: React.ReactNode
  logoClassName: string
  activeClassName: string
  name: string
  recommended?: boolean
  comingSoon?: boolean
  paperOnly?: boolean
  description: string
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={comingSoon ? undefined : onClick}
      disabled={comingSoon}
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border p-4 text-start transition-colors",
        comingSoon ? "cursor-not-allowed opacity-60" : active ? activeClassName : "border-border hover:bg-accent/40"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-white", logoClassName)}>
          {logo}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{name}</span>
            {recommended && (
              <span className="inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                <Star className="size-2.5 fill-current" /> {t("Recommended")}
              </span>
            )}
            {comingSoon && (
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t("Coming soon")}
              </span>
            )}
            {paperOnly && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                {t("Paper only")}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {active && !comingSoon && <Check className="size-5 shrink-0" />}
    </button>
  )
}

export function PropFirmSync({
  accounts,
  mtConnections,
  rithmicConnections,
  tradingviewConnections = [],
  tradingviewPairings = [],
  isPro,
}: {
  accounts: { id: number; name: string }[]
  mtConnections: Connection[]
  rithmicConnections: RithmicConnection[]
  tradingviewConnections?: TradingViewConnectionView[]
  tradingviewPairings?: TradingViewPairingView[]
  isPro: boolean
}) {
  const t = useT()
  const [platform, setPlatform] = useState<Platform>("rithmic")

  return (
    <div className="space-y-5">
      {/* TradingView is left out: its card's paste route works on every
          plan, so an upgrade banner over it would be selling something the
          trader doesn't need. */}
      {!isPro && platform !== "other" && platform !== "tradingview" && (
        <LiveSyncUpgradeBanner
          title={platform === "rithmic" ? t("Rithmic Connection") : t("MetaTrader Connection")}
          description={
            platform === "rithmic"
              ? t("Connect your prop firm and every trade lands in your journal automatically — no CSV needed. Rithmic sync into the journal is included with Pro.")
              : t("Connect your MetaTrader 4/5 account and every trade lands in your journal automatically — no CSV needed. Live sync into the journal is included with Pro.")
          }
        />
      )}

      <Card className="max-w-2xl gap-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            01
          </span>
          <h2 className="font-semibold">{t("Select your platform")}</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <PlatformCard
            active={platform === "rithmic"}
            onClick={() => setPlatform("rithmic")}
            logo="R"
            logoClassName="bg-emerald-600"
            activeClassName="border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            name="Rithmic"
            recommended
            description={t("Live sync — auto-imports every trade")}
          />
          <PlatformCard
            active={platform === "tradingview"}
            onClick={() => setPlatform("tradingview")}
            logo="TV"
            logoClassName="bg-[#2962ff]"
            activeClassName="border-[#2962ff] bg-[#2962ff]/10 text-[#2962ff]"
            name="TradingView"
            paperOnly
            description={t("Auto-sync paper trades through the TradeLoop extension")}
          />
          <PlatformCard
            active={platform === "metatrader"}
            onClick={() => setPlatform("metatrader")}
            logo="MT"
            logoClassName="bg-blue-600"
            activeClassName="border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
            name="MT4 / MT5"
            comingSoon
            description={t("Live sync — MetaTrader 4 & 5")}
          />
          <PlatformCard
            active={platform === "other"}
            onClick={() => setPlatform("other")}
            logo={<Search className="size-4.5" />}
            logoClassName="bg-muted-foreground/70"
            activeClassName="border-foreground/40 bg-accent text-foreground"
            name={t("Another platform")}
            description={t("NinjaTrader, Tradovate & more — auto-detected")}
          />
        </div>
      </Card>

      {platform === "rithmic" && isPro && <RithmicConnect connections={rithmicConnections} />}
      {platform === "tradingview" && (
        <div className="space-y-3">
          <div className="flex max-w-2xl items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              {t("TradingView sync is for paper-trading accounts only. For a funded or live prop-firm account, connect it through Rithmic — that reads your real fills and account balance.")}
            </p>
          </div>
          <TradingViewConnect connections={tradingviewConnections} pairings={tradingviewPairings} accounts={accounts} isPro={isPro} />
        </div>
      )}
      {platform === "metatrader" && isPro && <MetaTraderConnect connections={mtConnections} />}
      {platform === "other" && <BrokerImport accounts={accounts} />}
    </div>
  )
}
