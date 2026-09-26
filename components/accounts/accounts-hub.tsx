"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight } from "lucide-react"
import type { TradingViewPairingView } from "@/app/actions/tradingview"
import { useT } from "@/components/locale-provider"
import { AddAccountModal, type AddAccountRequest, type TradovateSetup } from "@/components/accounts/add-account-modal"
import { AccountsList } from "@/components/accounts/accounts-list"
import { SecurityCard } from "@/components/accounts/security-card"
import type { HubAccount, HubConnection, PlatformId } from "@/components/accounts/types"
import type { PlanUsage } from "@/lib/plan-allowance"

// Accounts = where trades come from: the page header (breadcrumb, title),
// the list of accounts with their health — "+ Add account" sits in its header —
// and a short note on how syncing works. Adding an account — from the list, Reconnect or
// /accounts?connect= — happens in the Add account window (choose a platform →
// connect → verify, reusing each platform's own form).
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
  tradovate,
  initialPlatform = null,
}: {
  initialPlatform?: PlatformId | null // /accounts?connect=mt5 opens that flow
  connections: HubConnection[]
  otherAccounts: HubAccount[]
  isPro: boolean
  usage: PlanUsage | null // Essential's allowance; null on Pro
  pairings: TradingViewPairingView[]
  importAccounts: { id: number; name: string }[]
  tradovate: TradovateSetup
}) {
  const t = useT()
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(initialPlatform != null)
  const [request, setRequest] = useState<AddAccountRequest>({ platform: initialPlatform, tradovateConnectionId: tradovate.connectionId, nonce: 0 })

  // Closing the window after a Tradovate sign-in drops ?tradovate=… from the
  // address, so a refresh doesn't reopen it.
  const onModalOpenChange = useCallback(
    (open: boolean) => {
      setModalOpen(open)
      if (!open && typeof window !== "undefined" && /[?&](tradovate|tradovate_error|connect)=/.test(window.location.search)) router.replace("/accounts", { scroll: false })
    },
    [router],
  )

  const openModal = useCallback((platform: PlatformId | null = null, initial?: AddAccountRequest["initial"]) => {
    setRequest((r) => ({ platform, initial, nonce: r.nonce + 1 }))
    setModalOpen(true)
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
        </header>

        {/* ≥ 1100px: the list, with the "how it works" note in a side column
            that stays in view. Narrower: the note under the list. */}
        <div className="grid items-start gap-5 @[1100px]/page:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <AccountsList
              connections={connections}
              otherAccounts={otherAccounts}
              usage={usage}
              onConnect={() => openModal()}
              onReconnect={(target) => openModal(target.platform, { server: target.server, login: target.login })}
            />
          </div>

          <div className="min-w-0 @[1100px]/page:sticky @[1100px]/page:top-6">
            <SecurityCard />
          </div>
        </div>
      </div>

      <AddAccountModal
        open={modalOpen}
        request={request}
        onOpenChange={onModalOpenChange}
        isPro={isPro}
        usage={usage}
        pairings={pairings}
        importAccounts={importAccounts}
        tradovate={tradovate}
      />
    </div>
  )
}
