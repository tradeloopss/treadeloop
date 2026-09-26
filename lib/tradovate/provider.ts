import type {
  NormalizedAccount,
  NormalizedExecution,
  NormalizedOrder,
  NormalizedPosition,
  ProviderIdentity,
  ProviderTokens,
  RealtimeHandlers,
  RealtimeSubscription,
  TradingProvider,
} from "@/lib/providers/types"
import { ProviderError } from "@/lib/providers/types"
import { httpTradovateApi, type TradovateApi } from "@/lib/tradovate/api"
import { SYNC_ENTITY_TYPES, tradovateConfig, type TradovateConfig, type TradovateEndpoint } from "@/lib/tradovate/config"
import type { HttpDeps } from "@/lib/tradovate/http"
import { InstrumentCache } from "@/lib/tradovate/instruments"
import { MOCK_IDENTITY, mockTokens, mockTradovateApi } from "@/lib/tradovate/mock"
import { normalizeAccount, normalizeFills, normalizeOrder, normalizePosition } from "@/lib/tradovate/normalize"
import { authorizeUrl, exchangeCode, freshTokens, me } from "@/lib/tradovate/oauth"
import { TradovateSocket, type SocketLike } from "@/lib/tradovate/realtime"

// Tradovate behind the provider-neutral TradingProvider interface. The sync
// engine (lib/tradovate/sync.ts) stores and reconciles; this adapter only
// talks to Tradovate and translates. TRADOVATE_MODE=mock swaps in fixture
// data end to end.
export class TradovateProvider implements TradingProvider {
  readonly id = "tradovate" as const
  private config: TradovateConfig
  private http: HttpDeps
  private instruments = new InstrumentCache()
  private createSocket: ((url: string) => SocketLike) | null

  constructor(opts: { config?: TradovateConfig; http?: HttpDeps; createSocket?: (url: string) => SocketLike } = {}) {
    this.config = opts.config ?? tradovateConfig()
    this.http = opts.http ?? {}
    this.createSocket = opts.createSocket ?? null
  }

  private get mock() {
    return this.config.mode === "mock"
  }

  environments(): string[] {
    return this.config.endpoints.map((e) => e.environment)
  }

  private endpoint(environment: string): TradovateEndpoint {
    const e = this.config.endpoints.find((x) => x.environment === environment)
    if (!e) throw new ProviderError("config", `Tradovate's ${environment} environment isn't configured.`)
    return e
  }

  api(environment: string, tokens: ProviderTokens): TradovateApi {
    const e = this.endpoint(environment)
    return this.mock ? mockTradovateApi(e.environment) : httpTradovateApi(e.environment, e.restUrl, () => tokens.accessToken, this.http)
  }

  authorizeUrl(state: string): string {
    return authorizeUrl(this.config, state)
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    if (this.mock) {
      if (code !== "mock-code") throw new ProviderError("auth", "Tradovate declined the sign-in.")
      return mockTokens()
    }
    return exchangeCode(this.config, code, this.http)
  }

  async refreshAuth(tokens: ProviderTokens): Promise<ProviderTokens> {
    if (this.mock) return mockTokens()
    return freshTokens(this.config, this.config.endpoints[0].restUrl, { ...tokens, accessExpiresAt: new Date(0) }, this.http)
  }

  async identity(tokens: ProviderTokens): Promise<ProviderIdentity> {
    if (this.mock) return MOCK_IDENTITY
    const endpoint = this.config.endpoints[0]
    if (!endpoint) throw new ProviderError("config", "Tradovate isn't configured on this server.")
    return me(endpoint.restUrl, tokens, this.http)
  }

  async getAccounts(environment: string, tokens: ProviderTokens): Promise<NormalizedAccount[]> {
    const api = this.api(environment, tokens)
    const accounts = await api.accounts()
    return Promise.all(accounts.map(async (a) => normalizeAccount(environment, a, await api.cashBalance(a.id))))
  }

  async getOrders(environment: string, tokens: ProviderTokens): Promise<NormalizedOrder[]> {
    const api = this.api(environment, tokens)
    const orders = await api.orders()
    const specs = await this.instruments.resolve(api, orders.map((o) => o.contractId).filter((n): n is number => typeof n === "number"))
    return orders.map((o) => normalizeOrder(environment, o, specs))
  }

  async getExecutions(environment: string, tokens: ProviderTokens): Promise<NormalizedExecution[]> {
    const api = this.api(environment, tokens)
    const [orders, fills] = await Promise.all([api.orders(), api.fills()])
    const fees = fills.length ? await api.fillFees(fills.map((f) => f.id)) : []
    const specs = await this.instruments.resolve(api, fills.map((f) => f.contractId))
    return normalizeFills(environment, fills, new Map(orders.map((o) => [o.id, o.accountId])), specs, new Map(fees.map((f) => [f.id, f]))).executions
  }

  async getPositions(environment: string, tokens: ProviderTokens): Promise<NormalizedPosition[]> {
    const api = this.api(environment, tokens)
    const positions = await api.positions()
    const specs = await this.instruments.resolve(api, positions.map((p) => p.contractId))
    return positions.map((p) => normalizePosition(environment, p, specs))
  }

  subscribeRealtime(environment: string, tokens: ProviderTokens, identity: ProviderIdentity, handlers: RealtimeHandlers, token?: () => string): RealtimeSubscription {
    if (this.mock) return { close: async () => {} } // fixtures don't stream
    if (!this.createSocket) throw new ProviderError("config", "Realtime needs a WebSocket implementation (the sync worker provides one).")
    return new TradovateSocket({
      environment,
      url: this.endpoint(environment).wsUrl,
      token: token ?? (() => tokens.accessToken),
      userId: identity.providerUserId,
      entityTypes: SYNC_ENTITY_TYPES,
      handlers,
      createSocket: this.createSocket,
    }).start()
  }

  async healthCheck(environment: string, tokens: ProviderTokens): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.api(environment, tokens).accounts()
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "unreachable" }
    }
  }
}
