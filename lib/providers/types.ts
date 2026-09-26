// Provider-neutral trading data. A provider adapter (lib/tradovate today;
// Rithmic, MT4 and MT5 can map into the same shapes) turns its own API objects
// into these, and everything downstream — storage (provider_* tables), the
// trade engine (lib/fill-reconstruction) and the journal — only sees these.
//
// Deliberately plain TypeScript (no enums, no parameter properties) so the
// pure parts of the integration run under Node's type stripping in tests.

export type ProviderId = "tradovate" | "rithmic" | "mt4" | "mt5"
export type Side = "buy" | "sell"
export type AssetClass = "future" | "option" | "forex" | "cfd" | "stock" | "crypto"

export interface NormalizedAccount {
  provider: ProviderId
  environment: string // e.g. Tradovate's "demo" or "live"
  providerAccountId: string
  name: string
  accountType: string | null
  currency: string
  balance: number | null
  equity: number | null
  availableMargin: number | null
  active: boolean
  metadata?: Record<string, unknown>
}

export interface NormalizedExecution {
  provider: ProviderId
  environment: string
  providerAccountId: string
  providerExecutionId: string | null // null when the provider gives none — see executionKey()
  providerOrderId: string | null
  symbol: string // e.g. "ESZ5"
  contractMonth: string | null // "2025-12" for dated contracts
  assetClass: AssetClass
  side: Side
  quantity: number
  price: number
  pointValue: number | null // currency per 1.0 of price per contract, from the provider when it knows
  timestamp: Date
  commission: number | null // all fees on this execution, when the provider reports them
  currency: string
  active: boolean // false = busted/cancelled by the exchange or broker
  metadata?: Record<string, unknown>
}

export interface NormalizedOrder {
  provider: ProviderId
  environment: string
  providerOrderId: string
  providerAccountId: string
  symbol: string | null
  contractId: string | null
  side: Side | null
  quantity: number | null
  orderType: string | null
  limitPrice: number | null
  stopPrice: number | null
  status: string | null
  submittedAt: Date | null
  raw: Record<string, unknown>
}

export interface NormalizedPosition {
  provider: ProviderId
  environment: string
  providerAccountId: string
  contractId: string
  symbol: string | null
  netQuantity: number // signed: + long, − short
  averagePrice: number | null
  updatedAt: Date | null
}

export interface ProviderTokens {
  accessToken: string
  accessExpiresAt: Date
  refreshToken: string | null
  refreshExpiresAt: Date | null
}

export interface ProviderIdentity {
  providerUserId: string
  name: string | null
}

// What a provider streams in real time (Tradovate: user/syncrequest "props").
export interface RealtimeEvent {
  environment: string
  entityType: string
  eventType: "Created" | "Updated" | "Deleted"
  entity: Record<string, unknown>
}

export type RealtimeStatus = "connecting" | "authorizing" | "live" | "degraded" | "closed"

export interface RealtimeHandlers {
  onEvent: (event: RealtimeEvent) => void | Promise<void>
  // The provider's initial sync payload (entity arrays by type), once per socket.
  onSnapshot?: (environment: string, entities: Record<string, unknown[]>) => void | Promise<void>
  onStatus?: (status: RealtimeStatus, detail?: string) => void
}

export interface RealtimeSubscription {
  close: () => Promise<void>
}

// One provider behind one interface. Connecting, syncing and disconnecting
// are orchestration over these calls and live in the sync engine (e.g.
// lib/tradovate/sync.ts), not in the adapter, so every provider gets the same
// idempotent storage, reconciliation and trade building.
export interface TradingProvider {
  readonly id: ProviderId
  environments(): string[]
  authorizeUrl(state: string): string
  exchangeCode(code: string): Promise<ProviderTokens>
  refreshAuth(tokens: ProviderTokens): Promise<ProviderTokens>
  identity(tokens: ProviderTokens): Promise<ProviderIdentity>
  getAccounts(environment: string, tokens: ProviderTokens): Promise<NormalizedAccount[]>
  getOrders(environment: string, tokens: ProviderTokens): Promise<NormalizedOrder[]>
  getExecutions(environment: string, tokens: ProviderTokens): Promise<NormalizedExecution[]>
  getPositions(environment: string, tokens: ProviderTokens): Promise<NormalizedPosition[]>
  subscribeRealtime(environment: string, tokens: ProviderTokens, identity: ProviderIdentity, handlers: RealtimeHandlers): RealtimeSubscription
  healthCheck(environment: string, tokens: ProviderTokens): Promise<{ ok: boolean; detail?: string }>
}

// Why a provider call failed, in terms the sync engine can act on. Messages
// are written for users and never carry tokens or secrets.
export type ProviderErrorKind =
  | "auth" // token rejected/expired — renew or refresh
  | "reauth" // renewal and refresh both failed — the user must reconnect
  | "forbidden" // authorized, but not allowed (missing API access, wrong scope)
  | "rate_limited" // back off until retryAfterMs
  | "captcha" // a penalty ticket that needs a human — never automated; wait it out
  | "not_found"
  | "network"
  | "server"
  | "invalid"
  | "config"

export class ProviderError extends Error {
  kind: ProviderErrorKind
  status: number | null
  retryAfterMs: number | null
  constructor(kind: ProviderErrorKind, message: string, opts: { status?: number | null; retryAfterMs?: number | null } = {}) {
    super(message)
    this.name = "ProviderError"
    this.kind = kind
    this.status = opts.status ?? null
    this.retryAfterMs = opts.retryAfterMs ?? null
  }
}
