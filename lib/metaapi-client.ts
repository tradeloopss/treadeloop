// Must import the /esm-node subpath explicitly — the package's default ESM
// export resolves to its browser build (which references `window`), and
// breaks module evaluation in this server-only file.
import MetaApi from "metaapi.cloud-sdk/esm-node"
import { recordApiUsage } from "@/lib/telemetry"
import type { ImportedTrade } from "@/lib/trade-import"

export type MtPlatform = "mt4" | "mt5"

export class MetaApiConnectError extends Error {}

export type BrokerServer = { broker: string; server: string }

// MetaApi's SDK silently retries createAccount for a while when the server
// responds "settings detection in progress, retry in Ns" instead of failing
// fast — normally brief, but during/after a rate limit it can hang for a
// long time with no way to tell from the caller's side. A hard timeout turns
// that into a clear failure instead of an indefinitely spinning UI.
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new MetaApiConnectError(message)), ms)),
  ])
}

// MetaApi has no "list all servers" endpoint, but createAccount's own
// E_SRV_NOT_FOUND error includes a fuzzy-matched list of real broker/server
// names when the given one isn't found — this deliberately triggers that
// error (with throwaway credentials, so nothing real is ever touched) to use
// it as a search. Only safe when the query is a broker-name fragment: an
// exact server-name match skips the fast "not found" path and proceeds into
// slow real account creation, so on that rare case the stray account this
// creates is torn down immediately before returning.
async function searchServersImpl(token: string, query: string, platform: MtPlatform): Promise<BrokerServer[]> {
  const api = new MetaApi(token)
  try {
    const account = await withTimeout(
      api.metatraderAccountApi.createAccount({
        name: "server-search-probe",
        login: "0000000",
        password: "probe-not-a-real-password",
        server: query,
        platform,
        magic: 0,
      }),
      15000,
      "Search timed out — MetaTrader may still be rate-limiting requests, try again shortly"
    )
    // The query happened to be an exact, valid server name — clean up the
    // stray account this created and report it as the sole match.
    await account.remove().catch(() => {})
    return [{ broker: query, server: query }]
  } catch (err: any) {
    if (err?.details?.code === "E_SRV_NOT_FOUND") {
      const byBroker = err.details.serversByBrokers ?? {}
      const results: BrokerServer[] = []
      for (const [broker, servers] of Object.entries(byBroker)) {
        for (const server of servers as string[]) results.push({ broker, server })
      }
      return results
    }
    return []
  } finally {
    api.close()
  }
}

export type ProvisionResult = {
  accountId: string
  // Read-only token scoped to just this one account — this is what gets
  // stored; the broad token passed into provisionAccount is used only
  // transiently here and is never persisted.
  readOnlyToken: string
  tokenValidityHours: number
}

// Provisions (or reuses) a MetaApi cloud account for the given MT login and
// waits for it to deploy and connect to the broker. The investor password is
// only used here, at provisioning time — MetaApi stores it on their side
// after that, so this app never needs to persist it. Immediately narrows the
// admin token down to reader-only access on just this account before
// returning, since account-scoped read access is all any future sync needs.
async function provisionAccountImpl(
  token: string,
  params: { name: string; login: string; investorPassword: string; server: string; platform: MtPlatform }
): Promise<ProvisionResult> {
  const api = new MetaApi(token)
  try {
    // createAccount can retry silently for a long time if MetaApi's broker
    // settings detection reports "in progress, retry in Ns" repeatedly —
    // bound it so a slow/rate-limited detection fails clearly instead of
    // leaving the connect button spinning forever.
    const account = await withTimeout(
      api.metatraderAccountApi.createAccount({
        name: params.name,
        login: params.login,
        password: params.investorPassword,
        server: params.server,
        platform: params.platform,
        magic: 0,
        // Default is 'high', which MetaApi bills as 2x resource slots
        // (redundant infra) — unnecessary for periodic history sync and
        // likely what pushed past the free tier into requiring a deposit.
        reliability: "regular",
      }),
      45000,
      "Connecting timed out — MetaTrader's broker detection may still be rate-limited from earlier attempts. Wait a while and try again."
    )

    await account.deploy()
    await withTimeout(account.waitConnected(60), 65000, "Connected to MetaApi, but the broker never confirmed the connection in time — double-check your login/password/server.")

    const accessRules = {
      applications: [
        "trading-account-management-api",
        "metaapi-rest-api",
        "metaapi-rpc-api",
        "metaapi-real-time-streaming-api",
      ],
      roles: ["reader"],
      resources: [{ entity: "account", id: account.id }],
    }
    // Request the longest validity the API allows; fall back to the SDK
    // default (24h) if a year is rejected as too long.
    let tokenValidityHours = 8760
    let readOnlyToken: string
    try {
      readOnlyToken = String(await api.tokenManagementApi.narrowDownToken(accessRules, tokenValidityHours))
    } catch {
      tokenValidityHours = 24
      readOnlyToken = String(await api.tokenManagementApi.narrowDownToken(accessRules, tokenValidityHours))
    }

    return { accountId: account.id, readOnlyToken, tokenValidityHours }
  } catch (err: any) {
    if (err?.details === "E_AUTH") {
      throw new MetaApiConnectError(
        `${err?.message ?? "MetaTrader rejected that login/password/server"} (use the investor password, not your trading password — and make sure the server matches your terminal exactly)`
      )
    }
    if (err?.details?.code === "E_SRV_NOT_FOUND") {
      const suggestions: string[] = Object.values(err.details.serversByBrokers ?? {}).flat() as string[]
      const hint = suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      throw new MetaApiConnectError(`Server "${params.server}" not found.${hint}`)
    }
    throw new MetaApiConnectError(err?.message ?? "Could not connect to MetaTrader")
  } finally {
    api.close()
  }
}

// Filters to actual buy/sell deals and groups them by MetaApi's own
// positionId — far more reliable than reconstructing position lifecycles
// from timestamps alone (which is all the HTML-report importer has to work
// with). Only fully-closed positions are emitted, same rule as the CSV/HTML
// importers, so a position still open at sync time is picked up next sync.
function dealsToTrades(deals: any[], accountLabel: string): ImportedTrade[] {
  const byPosition = new Map<string, any[]>()
  for (const d of deals) {
    if (d.type !== "DEAL_TYPE_BUY" && d.type !== "DEAL_TYPE_SELL") continue
    if (!d.positionId) continue
    if (!byPosition.has(d.positionId)) byPosition.set(d.positionId, [])
    byPosition.get(d.positionId)!.push(d)
  }

  const trades: ImportedTrade[] = []
  for (const [positionId, positionDeals] of byPosition) {
    const sorted = [...positionDeals].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const ins = sorted.filter((d) => d.entryType === "DEAL_ENTRY_IN")
    const outs = sorted.filter((d) => d.entryType === "DEAL_ENTRY_OUT" || d.entryType === "DEAL_ENTRY_OUT_BY")
    if (ins.length === 0 || outs.length === 0) continue

    const entryQty = ins.reduce((s, d) => s + (d.volume ?? 0), 0)
    const exitQty = outs.reduce((s, d) => s + (d.volume ?? 0), 0)
    if (entryQty <= 0 || Math.abs(entryQty - exitQty) > 0.0001) continue // only fully-closed positions

    const entryPrice = ins.reduce((s, d) => s + (d.price ?? 0) * (d.volume ?? 0), 0) / entryQty
    const exitPrice = outs.reduce((s, d) => s + (d.price ?? 0) * (d.volume ?? 0), 0) / exitQty
    const totalFees = sorted.reduce((s, d) => s + Math.abs(d.commission ?? 0) + Math.abs(d.swap ?? 0), 0)
    const totalProfit = sorted.reduce((s, d) => s + (d.profit ?? 0), 0)

    trades.push({
      externalId: `metatrader-live:${accountLabel}:${positionId}`,
      account: accountLabel,
      symbol: ins[0].symbol ?? outs[0].symbol ?? "UNKNOWN",
      side: ins[0].type === "DEAL_TYPE_BUY" ? "long" : "short",
      quantity: entryQty,
      entryPrice,
      exitPrice,
      entryTime: new Date(ins[0].time).toISOString(),
      exitTime: new Date(outs[outs.length - 1].time).toISOString(),
      fees: totalFees,
      pnl: totalProfit - totalFees,
    })
  }

  return trades.sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime())
}

export type AccountSnapshot = {
  trades: ImportedTrade[]
  balance: number
  currency: string
}

async function fetchAccountSnapshotImpl(
  token: string,
  metaApiAccountId: string,
  accountLabel: string,
  from: Date,
  to: Date
): Promise<AccountSnapshot> {
  const api = new MetaApi(token)
  try {
    const account = await api.metatraderAccountApi.getAccount(metaApiAccountId)
    const connection = account.getRPCConnection()
    await connection.connect()
    await connection.waitSynchronized()
    const [dealsResult, info] = await Promise.all([
      connection.getDealsByTimeRange(from, to),
      connection.getAccountInformation(),
    ])
    return {
      trades: dealsToTrades(dealsResult.deals ?? [], accountLabel),
      balance: info.balance,
      currency: info.currency,
    }
  } catch (err: any) {
    throw new MetaApiConnectError(err?.message ?? "Could not fetch account data from MetaTrader")
  } finally {
    api.close()
  }
}

// Every MetaApi call is recorded for the admin System page (usage + errors).
function metered<A extends unknown[], R>(operation: string, fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    const startedAt = Date.now()
    try {
      const result = await fn(...args)
      void recordApiUsage({ provider: "metaapi", operation, startedAt })
      return result
    } catch (err) {
      void recordApiUsage({ provider: "metaapi", operation, startedAt, error: err })
      throw err
    }
  }
}

export const searchServers = metered("search_servers", searchServersImpl)
export const provisionAccount = metered("provision_account", provisionAccountImpl)
export const fetchAccountSnapshot = metered("fetch_snapshot", fetchAccountSnapshotImpl)
