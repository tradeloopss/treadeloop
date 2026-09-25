import Link from "next/link"
import { getAccounts, getManualEntryLockedAccountIds } from "@/app/actions/accounts"
import { getPlaybooks } from "@/app/actions/playbooks"
import { PageHeader } from "@/components/page-header"
import { BrokerImport } from "@/components/broker-import"
import { ManualTradeForm } from "@/components/manual-trade-form"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowRight, Link2, PenLine, Upload } from "lucide-react"
import { getT } from "@/lib/i18n/server"

// Add Trade is for adding trades: a file, or by hand. Connecting a platform
// so trades arrive on their own lives on the Accounts page (/accounts).

// A large statement import can take a while to parse and insert.
export const maxDuration = 60

export default async function AddTradePage() {
  const t = await getT()
  const [accounts, playbooks, lockedAccountIds] = await Promise.all([getAccounts(), getPlaybooks(), getManualEntryLockedAccountIds()])

  // Prop firm / live-synced accounts are import-only, so they're not offered
  // for manual entry (enforced again server-side in createTrade).
  const manualEntryAccounts = accounts.filter((a) => !lockedAccountIds.includes(a.id))

  return (
    <div>
      <PageHeader title={t("Add Trade")} description={t("Bring your trades in however works best for you")} />
      <div className="space-y-5 p-4 sm:p-6">
        <Link
          href="/accounts"
          className="flex max-w-2xl items-center gap-3 rounded-xl border bg-primary/[0.03] p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
            <Link2 className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{t("Want trades to arrive on their own?")}</span>
            <span className="block text-xs text-muted-foreground">{t("Connect Rithmic, MetaTrader or TradingView on the Accounts page — every trade syncs automatically.")}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>

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
