import { tradovateRequest, type HttpDeps } from "@/lib/tradovate/http"
import type { TvAccount, TvCashBalance, TvContract, TvContractMaturity, TvFill, TvFillFee, TvOrder, TvPosition, TvProduct } from "@/lib/tradovate/types"

// Read-only access to one Tradovate environment (demo or live) for one user.
// TradeLoop never calls an order-placing or account-changing endpoint.
// The mock (lib/tradovate/mock.ts) implements the same interface, so the sync
// engine, worker and tests don't care which one they get.
export interface TradovateApi {
  readonly environment: "demo" | "live"
  accounts(): Promise<TvAccount[]>
  cashBalance(accountId: number): Promise<TvCashBalance | null>
  positions(): Promise<TvPosition[]>
  orders(): Promise<TvOrder[]>
  order(id: number): Promise<TvOrder | null>
  fills(): Promise<TvFill[]>
  fillFees(ids: number[]): Promise<TvFillFee[]>
  contracts(ids: number[]): Promise<TvContract[]>
  maturities(ids: number[]): Promise<TvContractMaturity[]>
  products(ids: number[]): Promise<TvProduct[]>
}

const CHUNK = 100

async function byIds<T>(ids: number[], load: (chunk: number[]) => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n))
  const out: T[] = []
  for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await load(unique.slice(i, i + CHUNK))))
  return out
}

export function httpTradovateApi(environment: "demo" | "live", restUrl: string, token: () => string, deps: HttpDeps = {}): TradovateApi {
  const get = <T>(path: string, query?: Record<string, string | number | undefined>) => tradovateRequest<T>(restUrl, { path, query, token: token() }, deps)
  const post = <T>(path: string, body: Record<string, unknown>) => tradovateRequest<T>(restUrl, { method: "POST", path, body, token: token() }, deps)
  return {
    environment,
    accounts: () => get<TvAccount[]>("/account/list"),
    cashBalance: async (accountId) => {
      try {
        return await post<TvCashBalance>("/cashBalance/getcashbalancesnapshot", { accountId })
      } catch {
        return null // a balance is nice to have; never fail a sync over it
      }
    },
    positions: () => get<TvPosition[]>("/position/list"),
    orders: () => get<TvOrder[]>("/order/list"),
    order: async (id) => {
      try {
        return await get<TvOrder>("/order/item", { id })
      } catch {
        return null
      }
    },
    fills: () => get<TvFill[]>("/fill/list"),
    fillFees: (ids) => byIds(ids, (chunk) => get<TvFillFee[]>("/fillFee/items", { ids: chunk.join(",") })),
    contracts: (ids) => byIds(ids, (chunk) => get<TvContract[]>("/contract/items", { ids: chunk.join(",") })),
    maturities: (ids) => byIds(ids, (chunk) => get<TvContractMaturity[]>("/contractMaturity/items", { ids: chunk.join(",") })),
    products: (ids) => byIds(ids, (chunk) => get<TvProduct[]>("/product/items", { ids: chunk.join(",") })),
  }
}
