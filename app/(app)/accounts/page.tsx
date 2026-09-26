import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { isOwner, isPro } from "@/lib/subscription"
import { getAccounts } from "@/app/actions/accounts"
import { getRithmicConnections } from "@/app/actions/rithmic"
import { getMetaTraderConnections } from "@/app/actions/metatrader"
import { getTradingViewConnections, getTradingViewPairings } from "@/app/actions/tradingview"
import { AccountsHub } from "@/components/accounts/accounts-hub"
import type { HubAccount, HubConnection, PlatformId } from "@/components/accounts/types"
import { recordRequestTiming } from "@/lib/telemetry"
import { brokerLogo } from "@/lib/broker-logos"
import { ESSENTIAL_ACCOUNT_LIMIT, ESSENTIAL_METATRADER_LIMIT, type PlanUsage } from "@/lib/plan-allowance"
import { getT } from "@/lib/i18n/server"
import { tradovateAvailability } from "@/lib/tradovate/config"
import { tradovateConnectionsFor } from "@/lib/tradovate/connections"

// Connecting Rithmic (login + account discovery + history) and "Sync all"
// run as server actions on this route and can take up to a minute.
export const maxDuration = 60

const num = (v: string | number | null | undefined) => (v == null || v === "" ? null : Number(v))

const CONNECTABLE: PlatformId[] = ["rithmic", "mt5", "mt4", "tradingview", "file", "tradovate"]

// ?tradovate=<id> — back from Tradovate's sign-in: the Add account window
// opens on that connection's first-sync progress. ?tradovate_error=<code> —
// the sign-in didn't complete.
const TRADOVATE_ERRORS: Record<string, string> = {
  denied: "Tradovate sign-in was cancelled or declined.",
  state: "That sign-in link expired or didn't match — please start again.",
  exchange: "Tradovate didn't complete the sign-in. Please try again.",
  rate: "Tradovate is limiting requests right now — please try again in a little while.",
  plan: "Tradovate sync is included with Pro.",
  unavailable: "Tradovate connections aren't available yet.",
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connect?: string; tradovate?: string; tradovate_error?: string }> }) {
  const startedAt = Date.now()
  const { connect, tradovate: tradovateParam, tradovate_error: tradovateErrorCode } = await searchParams
  const initialPlatform = CONNECTABLE.find((p) => p === connect) ?? (tradovateParam ? "tradovate" : null)
  const t = await getT()
  const session = await auth.api.getSession({ headers: await headers() })
  const [accounts, rithmic, metatrader, tradingview, pairings, pro, owner, tradovate] = await Promise.all([
    getAccounts(true),
    getRithmicConnections(),
    getMetaTraderConnections(),
    getTradingViewConnections(),
    getTradingViewPairings(),
    session?.user ? isPro(session.user.id) : Promise.resolve(false),
    session?.user ? isOwner(session.user.id) : Promise.resolve(false),
    // Never let Tradovate take the rest of the page down.
    session?.user
      ? tradovateConnectionsFor(session.user.id).catch((err) => {
          console.error("[accounts] tradovate connections unavailable:", err instanceof Error ? err.message : err)
          return []
        })
      : Promise.resolve([]),
  ])
  const tradovateStatus = tradovateAvailability()

  // Essential's allowance (lib/plan-allowance.ts), counted the way
  // lib/plan-limits.ts enforces it: every account, archived ones included.
  const isProPlan = pro || owner
  const usage: PlanUsage | null = isProPlan
    ? null
    : { accounts: accounts.length, accountLimit: ESSENTIAL_ACCOUNT_LIMIT, metatrader: metatrader.length, metatraderLimit: ESSENTIAL_METATRADER_LIMIT }

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
        // The broker's own logo when we ship one (Exness…), else MetaTrader's.
        logoName: brokerLogo(c.brokerName) ? c.brokerName : "MetaTrader",
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
          logoName: "TradingView",
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
    // One row per Tradovate account (a login can hold several, demo and live).
    ...tradovate.flatMap((c) =>
      c.status === "disconnected"
        ? []
        : c.accounts
            .filter((a) => a.enabled && a.status === "active")
            .map((a): HubConnection => {
              const acct = a.tradingAccountId != null ? account(a.tradingAccountId) : null
              const failing = c.status === "reauth" || c.status === "error"
              const health = failing ? "error" : c.status === "pending" ? "syncing" : c.errorCount > 0 || c.realtimeStatus === "degraded" ? "warning" : "connected"
              return {
                key: `tdv:${a.id}`,
                kind: "tradovate",
                connectionId: c.id,
                providerAccountRowId: a.id,
                title: acct?.name ?? `Tradovate - ${a.accountName}`,
                subtitle: `${a.environment === "live" ? t("Live") : t("Demo")} · ${a.accountName}`,
                logoName: "Tradovate",
                health,
                message: failing ? (c.statusMessage ?? c.lastSyncError) : c.errorCount > 0 ? c.lastSyncError : null,
                currency: a.currency,
                balance: a.balance,
                equity: a.equity,
                openPositions: a.openPositions,
                tradeCount: null,
                lastSyncedAt: c.lastSyncAt ? new Date(c.lastSyncAt) : null,
                canSync: !failing,
                account: acct,
                reconnect: failing ? { platform: "tradovate" } : null,
                diagnostics: [
                  { label: t("Realtime"), value: c.realtimeStatus === "live" ? t("Live") : c.realtimeStatus === "degraded" ? t("Reconnecting") : c.realtimeStatus === "connecting" ? t("Connecting") : t("Offline") },
                  { label: t("Last event"), at: c.lastRealtimeEventAt },
                  { label: t("Last reconciliation"), at: c.lastReconciledAt },
                  ...(c.errorCount > 0 ? [{ label: t("Recent errors"), value: String(c.errorCount) }] : []),
                ],
              }
            }),
    ),
  ]

  const otherAccounts = accounts.filter((a) => !linked.has(a.id)).map((a) => byId.get(a.id)!)
  const importAccounts = accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name }))

  void recordRequestTiming("/accounts", Date.now() - startedAt)
  return (
      <AccountsHub
        initialPlatform={initialPlatform}
        connections={connections}
        otherAccounts={otherAccounts}
        isPro={isProPlan}
        usage={usage}
        pairings={pairings}
        importAccounts={importAccounts}
        tradovate={{
          enabled: tradovateStatus.enabled,
          mock: tradovateStatus.mode === "mock",
          connectionId: tradovateParam && /^\d+$/.test(tradovateParam) ? Number(tradovateParam) : null,
          error: tradovateErrorCode ? (TRADOVATE_ERRORS[tradovateErrorCode] ?? TRADOVATE_ERRORS.exchange) : null,
        }}
      />
  )
}
