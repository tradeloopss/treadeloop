"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { TradingViewPairingView } from "@/app/actions/tradingview"
import { ConnectionWorkspace, type WorkspaceSelection } from "@/components/accounts/connection-workspace"
import { ConnectedAccountsPanel } from "@/components/accounts/connected-accounts-panel"
import { SecurityCard } from "@/components/accounts/security-card"
import type { HubAccount, HubConnection, PlatformId } from "@/components/accounts/types"

// Accounts = where trades come from. Left: connect a platform (a three-step
// flow reusing each platform's own form). Right: every connected account with
// its health, plus the accounts that have no live connection.
//
// Layout follows the width actually available to the page (container
// queries), not the viewport, since the sidebar may be a 240px panel or a
// 72px rail at the same screen size:
//   < 900px   one column: workspace, accounts, security (tablet portrait, phone)
//   900–1179  two columns, 340px accounts panel (tablet landscape)
//   ≥ 1180    two columns, 420px accounts panel (440px from 1500) — desktop
// The page uses the full width (no centred max-width column).
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
    <div className="@container/page">
      <div className="grid items-start gap-4 p-4 @[640px]/page:p-5 @[900px]/page:grid-cols-[minmax(0,1fr)_340px] @[1180px]/page:grid-cols-[minmax(0,1fr)_420px] @[1500px]/page:grid-cols-[minmax(0,1fr)_440px]">
        <ConnectionWorkspace selection={selection} onSelect={(p) => select(p)} isPro={isPro} pairings={pairings} importAccounts={importAccounts} />
        <div className="min-w-0 space-y-4">
          <ConnectedAccountsPanel
            connections={connections}
            otherAccounts={otherAccounts}
            onConnectAnother={() => select(null)}
            onReconnect={(target) => select(target.platform, { server: target.server, login: target.login })}
          />
          <SecurityCard />
        </div>
      </div>
    </div>
  )
}
