"use client"

import type React from "react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { BrokerImport } from "@/components/broker-import"
import { MetaTraderConnect, type Connection } from "@/components/metatrader-connect"
import { RithmicConnect, type RithmicConnection } from "@/components/rithmic-connect"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import { Star, Search, Check } from "lucide-react"
import { useT } from "@/components/locale-provider"

type Platform = "rithmic" | "metatrader" | "other"

function PlatformCard({
  active,
  onClick,
  logo,
  logoClassName,
  activeClassName,
  name,
  recommended,
  comingSoon,
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
  description: string
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={comingSoon ? undefined : onClick}
      disabled={comingSoon}
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border p-4 text-start transition-colors",
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
          </div>
          <p className="truncate text-sm text-muted-foreground">{description}</p>
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
  isPro,
}: {
  accounts: { id: number; name: string }[]
  mtConnections: Connection[]
  rithmicConnections: RithmicConnection[]
  isPro: boolean
}) {
  const t = useT()
  const [platform, setPlatform] = useState<Platform>("rithmic")

  return (
    <div className="space-y-5">
      {!isPro && platform !== "other" && (
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
      {platform === "metatrader" && isPro && <MetaTraderConnect connections={mtConnections} />}
      {platform === "other" && <BrokerImport accounts={accounts} />}
    </div>
  )
}
