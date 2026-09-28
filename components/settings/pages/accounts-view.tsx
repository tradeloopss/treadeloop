"use client"

import Link from "next/link"
import { Wallet, ArrowUpRight } from "lucide-react"
import { SettingsHeader, Panel } from "@/components/settings/chrome"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"

export function AccountsSettingsView({ activeCount, archivedCount }: { activeCount: number; archivedCount: number }) {
  const t = useT()
  return (
    <div className="space-y-6">
      <SettingsHeader icon={Wallet} title={t("Accounts")} />
      <Panel title={t("Trading Accounts")}>
        <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-3">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-2xl font-semibold tabular-nums">{activeCount}</p>
              <p className="text-xs text-muted-foreground">{t("Active")}</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-muted-foreground">{archivedCount}</p>
              <p className="text-xs text-muted-foreground">{t("Archived")}</p>
            </div>
          </div>
          <Button size="sm" render={<Link href="/accounts" />}>
            {t("Manage accounts")}
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          {t("Connect brokers, sync trades, edit balances and reconnect accounts on the Accounts page.")}
        </p>
      </Panel>
    </div>
  )
}
