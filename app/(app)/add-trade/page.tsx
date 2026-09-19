import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { isPro } from "@/lib/subscription"
import { getAccounts, getManualEntryLockedAccountIds } from "@/app/actions/accounts"
import { getPlaybooks } from "@/app/actions/playbooks"
import { getMetaTraderConnections } from "@/app/actions/metatrader"
import { getRithmicConnections } from "@/app/actions/rithmic"
import { getTradingViewConnections } from "@/app/actions/tradingview"
import { PageHeader } from "@/components/page-header"
import { BrokerImport } from "@/components/broker-import"
import { MetaTraderConnect } from "@/components/metatrader-connect"
import { TradingViewConnect } from "@/components/tradingview-connect"
import { LiveSyncUpgradeBanner } from "@/components/live-sync-upgrade-banner"
import { PropFirmSync } from "@/components/prop-firm-sync"
import { ManualTradeForm } from "@/components/manual-trade-form"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Upload, Wifi, Building2, PenLine } from "lucide-react"
import { getT } from "@/lib/i18n/server"

export default async function AddTradePage() {
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [accounts, playbooks, mtConnections, rithmicConnections, tvConnections, pro, lockedAccountIds] = await Promise.all([
    getAccounts(),
    getPlaybooks(),
    getMetaTraderConnections(),
    getRithmicConnections(),
    getTradingViewConnections(),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
    getManualEntryLockedAccountIds(),
  ])

  // Prop firm / live-synced accounts are import-only, so they're not offered
  // for manual entry (enforced again server-side in createTrade).
  const manualEntryAccounts = accounts.filter((a) => !lockedAccountIds.includes(a.id))

  return (
    <div>
      <PageHeader title={t("Add Trade")} description={t("Bring your trades in however works best for you")} />
      <div className="p-4 sm:p-6">
        <Tabs defaultValue="upload" className="items-start gap-5">
          <TabsList className="group-data-horizontal/tabs:h-auto w-full max-w-2xl flex-wrap justify-start gap-2 rounded-xl border bg-muted/30 p-2">
            <TabsTrigger
              value="upload"
              className="h-10 shrink-0 gap-2.5 rounded-lg border border-transparent px-3.5 text-sm font-medium text-muted-foreground data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-sm"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                <Upload className="size-3.5" />
              </span>
              {t("File Upload")}
            </TabsTrigger>
            <TabsTrigger
              value="broker"
              className="h-10 shrink-0 gap-2.5 rounded-lg border border-transparent px-3.5 text-sm font-medium text-muted-foreground data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-sm"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
                <Wifi className="size-3.5" />
              </span>
              {t("Broker Sync")}
            </TabsTrigger>
            <TabsTrigger
              value="propfirm"
              className="h-10 shrink-0 gap-2.5 rounded-lg border border-transparent px-3.5 text-sm font-medium text-muted-foreground data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-sm"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-500">
                <Building2 className="size-3.5" />
              </span>
              {t("Prop Firm Sync")}
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="h-10 shrink-0 gap-2.5 rounded-lg border border-transparent px-3.5 text-sm font-medium text-muted-foreground data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-sm"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                <PenLine className="size-3.5" />
              </span>
              {t("Manual")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="w-full">
            <BrokerImport accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
          </TabsContent>

          <TabsContent value="broker" className="w-full space-y-5">
            <p className="max-w-lg text-sm text-muted-foreground">
              {t("Connect your personal broker account — trades sync automatically, no file exports needed.")}
            </p>
            {pro ? (
              <>
                <TradingViewConnect connections={tvConnections} />
                <MetaTraderConnect connections={mtConnections} />
              </>
            ) : (
              <LiveSyncUpgradeBanner
                title={t("TradingView & MetaTrader Connection")}
                description={t("Connect TradingView or your MetaTrader 4/5 account and every trade lands in your journal automatically — no CSV needed. Live sync into the journal is included with Pro.")}
              />
            )}
          </TabsContent>

          <TabsContent value="propfirm" className="w-full">
            <PropFirmSync
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              mtConnections={mtConnections}
              rithmicConnections={rithmicConnections}
              tradingviewConnections={tvConnections}
              isPro={pro}
            />
          </TabsContent>

          <TabsContent value="manual" className="w-full">
            <Card className="max-w-2xl p-5">
              <h2 className="mb-4 font-medium">{t("Log a trade manually")}</h2>
              <ManualTradeForm
                accounts={manualEntryAccounts.map((a) => ({ id: a.id, name: a.name }))}
                playbooks={playbooks.map((p) => ({ id: p.id, name: p.name }))}
              />
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
