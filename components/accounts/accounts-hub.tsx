"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import type { TradingViewPairingView } from "@/app/actions/tradingview"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"
import { ConnectionWorkspace, type WorkspaceSelection } from "@/components/accounts/connection-workspace"
import { AccountsList } from "@/components/accounts/accounts-list"
import { SecurityCard } from "@/components/accounts/security-card"
import type { HubAccount, HubConnection, PlatformId } from "@/components/accounts/types"

// Accounts = where trades come from. One column, top to bottom: the page
// header (with "+ Add account"), the connection card (choose a platform →
// connect → verify, reusing each platform's own form), the full-width list of
// accounts with their health, and a short note on how syncing works.
//
// Spacing follows the width actually available to the page (container
// queries), since the sidebar may be a 240px panel or a 72px rail at the same
// screen size: 16px padding on phones, 24px on tablets, 32px on desktop.
export function AccountsHub({
  connections,
  otherAccounts,
  isPro,
  pairings,
  importAccounts,
  initialPlatform = null,
}: {
  initialPlatform?: PlatformId | null // /accounts?connect=mt5 opens that flow
  connections: HubConnection[]
  otherAccounts: HubAccount[]
  isPro: boolean
  pairings: TradingViewPairingView[]
  importAccounts: { id: number; name: string }[]
}) {
  const t = useT()
  const router = useRouter()
  const [selection, setSelection] = useState<WorkspaceSelection>({ platform: initialPlatform, nonce: 0 })

  const select = useCallback((platform: PlatformId | null, initial?: WorkspaceSelection["initial"]) => {
    setSelection((s) => ({ platform, initial, nonce: s.nonce + 1 }))
  }, [])

  // Statuses, balances and "last synced" come from the server; refresh them
  // gently while the page is in view (the sync server updates every minute).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, 30_000)
    return () => clearInterval(id)
  }, [router])

  return (
    <div className="@container/page min-h-full bg-background">
      <div className="space-y-6 p-4 @[640px]/page:p-6 @[1100px]/page:space-y-8 @[1100px]/page:p-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl leading-[30px] font-semibold tracking-[-0.6px] text-foreground @[768px]/page:text-[30px] @[768px]/page:leading-9">{t("Accounts")}</h1>
            <p className="mt-1 max-w-[640px] text-sm text-muted-foreground">
              <span className="@[640px]/page:hidden">{t("Manage your trading connections.")}</span>
              <span className="hidden @[640px]/page:inline">{t("Manage your connected trading accounts and choose where TradeLoop gets your trades.")}</span>
            </p>
          </div>
          <Button onClick={() => select(null)} aria-label={t("Add account")} className="size-11 shrink-0 rounded-[9px] p-0 font-semibold hover:bg-primary/90 @[640px]/page:h-10 @[640px]/page:w-auto @[640px]/page:px-4">
            <Plus className="size-4" />
            <span className="hidden @[640px]/page:inline">{t("Add account")}</span>
          </Button>
        </header>

        <ConnectionWorkspace selection={selection} onSelect={(p) => select(p)} isPro={isPro} pairings={pairings} importAccounts={importAccounts} />

        <AccountsList
          connections={connections}
          otherAccounts={otherAccounts}
          onConnect={() => select(null)}
          onReconnect={(target) => select(target.platform, { server: target.server, login: target.login })}
        />

        <SecurityCard />
      </div>
    </div>
  )
}
