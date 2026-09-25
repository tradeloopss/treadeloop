"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Plus } from "lucide-react"
import type { TradingViewPairingView } from "@/app/actions/tradingview"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"
import { ConnectionWorkspace, type WorkspaceSelection } from "@/components/accounts/connection-workspace"
import { AccountsList } from "@/components/accounts/accounts-list"
import { SecurityCard } from "@/components/accounts/security-card"
import type { HubAccount, HubConnection, PlatformId } from "@/components/accounts/types"
import type { PlanUsage } from "@/lib/plan-allowance"

// Accounts = where trades come from: the page header (breadcrumb, "+ Add
// account"), the connection card (choose a platform → connect → verify,
// reusing each platform's own form), the list of accounts with their health,
// and a short note on how syncing works.
//
// Layout follows the width actually available to the page (container
// queries), since the sidebar may be a 240px panel or a 72px rail at the same
// screen size: 16px padding on phones, 24px from tablets up.
export function AccountsHub({
  connections,
  otherAccounts,
  isPro,
  usage,
  pairings,
  importAccounts,
  initialPlatform = null,
}: {
  initialPlatform?: PlatformId | null // /accounts?connect=mt5 opens that flow
  connections: HubConnection[]
  otherAccounts: HubAccount[]
  isPro: boolean
  usage: PlanUsage | null // Essential's allowance; null on Pro
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
      <div className="space-y-5 p-4 @[640px]/page:p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <nav aria-label={t("Breadcrumb")} className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Link href="/settings" className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
                {t("Settings")}
              </Link>
              <ChevronRight className="size-3" aria-hidden />
              <span aria-current="page" className="font-medium text-foreground">
                {t("Accounts")}
              </span>
            </nav>
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.5px] text-foreground @[768px]/page:text-[26px]">{t("Accounts")}</h1>
            <p className="mt-1 max-w-[640px] text-sm text-muted-foreground">
              <span className="@[640px]/page:hidden">{t("Manage your trading connections.")}</span>
              <span className="hidden @[640px]/page:inline">{t("Manage your connected trading accounts and choose where TradeLoop gets your trades.")}</span>
            </p>
          </div>
          <Button onClick={() => select(null)} className="h-10 shrink-0 rounded-[9px] px-3 font-semibold hover:bg-primary/90 @[640px]/page:px-4">
            <Plus className="size-4" />
            {t("Add account")}
          </Button>
        </header>

        {/* ≥ 1180px: connect + accounts on the left, the "how it works" note in
            a side column that stays in view. 1000–1179: connect | accounts side
            by side, the note underneath. Narrower: one column. */}
        <div className="grid items-start gap-5 @[1000px]/page:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @[1180px]/page:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 @[1180px]/page:col-start-1">
            <ConnectionWorkspace
              selection={selection}
              onSelect={(p) => select(p)}
              // Closing a platform's window just returns to the grid (no nonce
              // bump, so the page doesn't jump).
              onClose={() => setSelection((s) => ({ ...s, platform: null, initial: undefined }))}
              isPro={isPro}
              usage={usage}
              pairings={pairings}
              importAccounts={importAccounts}
            />
          </div>

          <div className="min-w-0 @[1180px]/page:col-start-1">
            <AccountsList
              connections={connections}
              otherAccounts={otherAccounts}
              usage={usage}
              onConnect={() => select(null)}
              onReconnect={(target) => select(target.platform, { server: target.server, login: target.login })}
            />
          </div>

          <div className="min-w-0 @[1000px]/page:col-span-2 @[1180px]/page:sticky @[1180px]/page:top-6 @[1180px]/page:col-span-1 @[1180px]/page:col-start-2 @[1180px]/page:row-span-2 @[1180px]/page:row-start-1">
            <SecurityCard />
          </div>
        </div>
      </div>
    </div>
  )
}
