import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { isOwner, isPro } from "@/lib/subscription"
import { getAccounts } from "@/app/actions/accounts"
import { getRithmicConnections } from "@/app/actions/rithmic"
import { getMetaTraderConnections } from "@/app/actions/metatrader"
import { getTradingViewConnections, getTradingViewPairings } from "@/app/actions/tradingview"
import Link from "next/link"
import { HelpCircle } from "lucide-react"
import { AccountsHub } from "@/components/accounts/accounts-hub"
import type { HubAccount, HubConnection, PlatformId } from "@/components/accounts/types"
import { recordRequestTiming } from "@/lib/telemetry"
import { getT } from "@/lib/i18n/server"

// Connecting Rithmic (login + account discovery + history) and "Sync all"
// run as server actions on this route and can take up to a minute.
export const maxDuration = 60

const num = (v: string | number | null | undefined) => (v == null || v === "" ? null : Number(v))

const CONNECTABLE: PlatformId[] = ["rithmic", "mt5", "mt4", "tradingview", "file"]

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const startedAt = Date.now()
  const { connect } = await searchParams
  const initialPlatform = CONNECTABLE.find((p) => p === connect) ?? null
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [accounts, rithmic, metatrader, tradingview, pairings, pro, owner] = await Promise.all([
    getAccounts(true),
    getRithmicConnections(),
    getMetaTraderConnections(),
    getTradingViewConnections(),
    getTradingViewPairings(),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
    session?.user ? isOwner(session.user.id) : Promise.resolve(false),
  ])

  const byId = new Map<number, HubAccount>(
    accounts.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        broker: a.broker,
        startingBalance: a.startingBalance,
        currentBalance: a.currentBalance,
        currency: a.currency,
        commissionPerContract: a.commissionPerContract,
        archived: a.archived,
      },
    ]),
  )
  const linked = new Set<number>()
  const account = (id: number | null) => {
    if (id == null) return null
    linked.add(id)
    return byId.get(id) ?? null
  }

  const connections: HubConnection[] = [
    ...rithmic.map((c): HubConnection => {
      const acct = account(c.accountId)
      return {
        key: `rithmic:${c.id}`,
        kind: "rithmic",
        connectionId: c.id,
        title: acct?.name ?? c.accountName,
        subtitle: c.systemName,
        logoName: acct?.broker ?? c.systemName,
        health: c.lastSyncStatus === "error" ? "warning" : c.lastSyncedAt ? "connected" : "syncing",
        message: c.lastSyncStatus === "error" ? c.lastSyncError : null,
        currency: acct?.currency ?? "USD",
        balance: num(acct?.currentBalance),
        equity: null,
        openPositions: null,
        tradeCount: null,
        lastSyncedAt: c.lastSyncedAt,
        canSync: true,
        account: acct,
        reconnect: null,
      }
    }),
    ...metatrader.map((c): HubConnection => {
      const acct = account(c.accountId)
      const kind = c.platform === "mt4" ? "mt4" : "mt5"
      const health =
        c.status === "error"
          ? "error"
          : c.status === "pending"
            ? c.statusMessage
              ? "queued"
              : "syncing"
            : c.lastSyncStatus === "error"
              ? "warning"
              : "connected"
      return {
        key: `mt:${c.id}`,
        kind,
        connectionId: c.id,
        title: acct?.name ?? `${c.brokerName ?? c.server} - ${c.login}`,
        subtitle: c.server,
        logoName: c.brokerName,
        health,
        message: c.status === "connected" ? (c.lastSyncStatus === "error" ? c.lastSyncError : null) : c.statusMessage,
        currency: c.currency ?? acct?.currency ?? "USD",
        balance: c.balance,
        equity: c.equity,
        openPositions: c.openPositions,
        tradeCount: null,
        lastSyncedAt: c.lastSyncedAt,
        canSync: c.status === "connected",
        account: acct,
        reconnect: { platform: kind, server: c.server, login: c.login },
      }
    }),
    // Extension-found paper accounts (the older webhook route isn't offered
    // any more, so its leftovers aren't listed as live connections).
    ...tradingview
      .filter((c) => c.kind === "extension")
      .map((c): HubConnection => {
        const acct = account(c.accountId)
        return {
          key: `tv:${c.id}`,
          kind: "tradingview",
          connectionId: c.id,
          title: acct?.name ?? c.name,
          subtitle: t("Paper"),
          logoName: null,
          health: c.lastStatus === "error" ? "warning" : "connected",
          message: c.lastStatus === "error" ? c.lastError : null,
          currency: c.currency,
          balance: c.currentBalance,
          equity: null,
          openPositions: null,
          tradeCount: c.tradeCount,
          lastSyncedAt: c.lastEventAt,
          canSync: false,
          account: acct,
          reconnect: null,
        }
      }),
  ]

  const otherAccounts = accounts.filter((a) => !linked.has(a.id)).map((a) => byId.get(a.id)!)
  const importAccounts = accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name }))

  void recordRequestTiming("/accounts", Date.now() - startedAt)
  return (
    <div className="min-h-full bg-background">
      {/* A slim bar rather than a page header: the workspace below carries the
          page's own heading, so the content starts right away. */}
      <div className="flex h-14 items-center justify-between gap-3 border-b px-4 md:h-16 md:px-5">
        <nav aria-label={t("Breadcrumb")} className="flex min-w-0 items-center gap-2 text-[13px]">
          <Link href="/settings" className="text-muted-foreground transition-colors hover:text-foreground">
            {t("Settings")}
          </Link>
          <span aria-hidden className="text-muted-foreground">/</span>
          <h1 className="truncate font-semibold text-foreground" aria-current="page">
            {t("Accounts")}
          </h1>
        </nav>
        <Link href="/support" className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <HelpCircle className="size-4" /> <span className="hidden sm:inline">{t("Need help?")}</span>
        </Link>
      </div>
      <AccountsHub initialPlatform={initialPlatform} connections={connections} otherAccounts={otherAccounts} isPro={pro || owner} pairings={pairings} importAccounts={importAccounts} />
    </div>
  )
}
