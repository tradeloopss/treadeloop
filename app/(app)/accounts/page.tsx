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
import { ninjaTraderViewFor, type NinjaTraderView } from "@/lib/ninjatrader/connections"
import { listCredentials, type NinjaCredentialView } from "@/lib/ninjatrader/credentials"
import { relayConfigured } from "@/lib/ninjatrader/relay"

// Connecting Rithmic (login + account discovery + history) and "Sync all"
// run as server actions on this route and can take up to a minute.
export const maxDuration = 60

const num = (v: string | number | null | undefined) => (v == null || v === "" ? null : Number(v))

const CONNECTABLE: PlatformId[] = ["rithmic", "mt5", "mt4", "tradingview", "file", "tradovate"]

// Prop-firm labels for a Tradovate-via-NinjaTrader login's subtitle (mirrors
// lib/ninjatrader/credentials TRADOVATE_CONNECTION_KINDS).
const TRADOVATE_KIND_LABELS: Record<string, string> = {
  Tradovate: "Tradovate",
  Apex: "Apex Trader Funding",
  Tradeify: "Tradeify",
  MyFundedFutures: "My Funded Futures",
  TakeProfitTrader: "Take Profit Trader",
  BluSky: "BluSky Trading",
}

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
  const [accounts, rithmic, metatrader, tradingview, pairings, pro, owner, tradovate, ninjatrader, ninjaCreds] = await Promise.all([
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
    session?.user
      ? ninjaTraderViewFor(session.user.id).catch((err): NinjaTraderView | null => {
          console.error("[accounts] ninjatrader view unavailable:", err instanceof Error ? err.message : err)
          return null
        })
      : Promise.resolve(null),
    session?.user
      ? listCredentials(session.user.id).catch((err): NinjaCredentialView[] => {
          console.error("[accounts] tradovate credential connections unavailable:", err instanceof Error ? err.message : err)
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

  // NinjaTrader connection names of the user's VPS credential logins, so their
  // accounts render as login rows (below) rather than duplicate per-account rows.
  const vpsConnNames = new Set(ninjaCreds.filter((c) => c.status !== "disconnected").map((c) => c.ntConnectionName.toLowerCase()))

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
    // Tradovate (or another broker) through the NinjaTrader add-on: one row per
    // account it reports. The add-on pushes fills itself while NinjaTrader is
    // open, so there's no "Sync now"; being offline just means it's closed.
    ...(ninjatrader?.connectionId != null
      ? ninjatrader.accounts
          .filter((a) => a.enabled && !(a.connectionName && vpsConnNames.has(a.connectionName.toLowerCase())))
          .map((a): HubConnection => {
            const acct = account(a.tradingAccountId)
            const deviceError = ninjatrader.devices.find((d) => d.lastStatus === "error")
            const health = a.planLimited ? "error" : deviceError ? "warning" : "connected"
            return {
              key: `nt:${a.id}`,
              kind: "ninjatrader",
              connectionId: ninjatrader.connectionId!,
              providerAccountRowId: a.id,
              title: acct?.name ?? a.name,
              subtitle: `${t("via NinjaTrader")} · ${a.connectionName ?? a.broker}`,
              // A prop firm's own logo when the account's name gives it away (APEX-…).
              logoName: brokerLogo(a.name) ? a.name : (acct?.broker ?? a.broker),
              health,
              message: a.planLimited ? t("Over your plan's account limit — upgrade to Pro to sync it.") : (deviceError?.lastError ?? null),
              currency: a.currency,
              balance: a.balance,
              equity: a.equity,
              openPositions: null,
              tradeCount: null,
              lastSyncedAt: ninjatrader.lastSeenAt ? new Date(ninjatrader.lastSeenAt) : null,
              canSync: false,
              account: acct,
              reconnect: null,
              diagnostics: [
                { label: t("NinjaTrader"), value: ninjatrader.online ? t("Online") : t("Offline — syncs when NinjaTrader is open") },
                { label: t("Last check-in"), at: ninjatrader.lastSeenAt },
                { label: t("Fills received"), value: String(a.executions) },
                { label: t("Last fill"), at: a.lastExecutionAt },
              ],
            }
          })
      : []),
    // Tradovate through NinjaTrader on the VPS (credentials): one row per
    // login, like MetaTrader. Its accounts land in the same ninjatrader
    // connection; a login with none yet shows as connecting.
    ...ninjaCreds
      .filter((c) => c.status !== "disconnected")
      .map((c): HubConnection => {
        const its = (ninjatrader?.accounts ?? []).filter((a) => a.enabled && a.connectionName?.toLowerCase() === c.ntConnectionName.toLowerCase())
        const solo = its.length === 1 ? account(its[0].tradingAccountId) : null
        const failing = c.status === "reauth" || c.status === "error"
        const planLimited = its.some((a) => a.planLimited)
        const health: HubConnection["health"] = failing || planLimited ? "error" : its.length === 0 ? (c.status === "pending" || c.status === "provisioning" ? "syncing" : "warning") : c.online ? "connected" : "warning"
        const kindLabel = TRADOVATE_KIND_LABELS[c.connectionKind] ?? c.connectionKind
        return {
          key: `ntc:${c.id}`,
          kind: "ninjatrader",
          connectionId: c.id,
          credentialLogin: true,
          providerAccountRowId: its.length === 1 ? its[0].id : undefined,
          title: solo?.name ?? its[0]?.name ?? `${kindLabel} — ${c.username}`,
          subtitle: `${t("Tradovate via NinjaTrader")} · ${kindLabel}${its.length > 1 ? ` · ${t("{n} accounts", { n: its.length })}` : ""}`,
          logoName: brokerLogo(its[0]?.name ?? c.connectionKind) ? (its[0]?.name ?? c.connectionKind) : (solo?.broker ?? "Tradovate"),
          health,
          message: failing
            ? (c.statusMessage ?? t("Tradovate rejected this login — reconnect with the right username and password."))
            : planLimited
              ? t("Over your plan's account limit — upgrade to Pro to sync it.")
              : its.length === 0
                ? c.status === "pending" || c.status === "provisioning"
                  ? t("Connecting your account on our server…")
                  : t("Waiting for NinjaTrader on our server to connect this login.")
                : null,
          currency: its[0]?.currency ?? "USD",
          balance: its.length === 1 ? its[0].balance : null,
          equity: its.length === 1 ? its[0].equity : null,
          openPositions: null,
          tradeCount: null,
          lastSyncedAt: c.lastFillAt ? new Date(c.lastFillAt) : c.lastSeenAt ? new Date(c.lastSeenAt) : null,
          canSync: false,
          account: solo,
          reconnect: failing ? { platform: "tradovate" } : null,
          diagnostics: [
            { label: t("Sync"), value: c.online ? t("Live") : failing ? t("Needs reconnect") : t("Connecting…") },
            { label: t("Last fill"), at: c.lastFillAt },
            ...(its.length > 0 ? [{ label: t("Accounts"), value: String(its.length) }] : []),
          ],
        }
      }),
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
          ninjaVps: relayConfigured(),
        }}
      />
  )
}
