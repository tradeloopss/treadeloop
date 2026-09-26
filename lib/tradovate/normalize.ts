import type { NormalizedAccount, NormalizedExecution, NormalizedOrder, NormalizedPosition, Side } from "@/lib/providers/types"
import type { InstrumentSpec } from "@/lib/tradovate/instruments"
import type { TvAccount, TvCashBalance, TvFill, TvFillFee, TvOrder, TvPosition } from "@/lib/tradovate/types"

// Tradovate API objects → the provider-neutral model (lib/providers/types).
// Pure: everything comes in as arguments, so it's unit-tested with fixtures.
//
// A Tradovate fill carries no account id — only its order does — so fills are
// attributed through orders. A fill whose order isn't known yet is returned
// as "unattributed" (the caller looks the order up and retries) rather than
// guessed.

const side = (action: string | undefined): Side | null => (action === "Buy" ? "buy" : action === "Sell" ? "sell" : null)

export function feeTotal(fee: TvFillFee | undefined): number | null {
  if (!fee) return null
  const parts = [fee.commission, fee.clearingFee, fee.exchangeFee, fee.nfaFee, fee.brokerageFee, fee.ipFee, fee.orderRoutingFee]
  const total = parts.reduce<number>((sum, v) => sum + (typeof v === "number" && Number.isFinite(v) ? v : 0), 0)
  return Math.round(total * 100) / 100
}

export function normalizeAccount(environment: string, a: TvAccount, balance: TvCashBalance | null): NormalizedAccount {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return {
    provider: "tradovate",
    environment,
    providerAccountId: String(a.id),
    name: a.nickname || a.name,
    accountType: a.accountType ?? null,
    currency: "USD", // Tradovate futures accounts are USD-denominated
    balance: num(balance?.totalCashValue),
    equity: num(balance?.netLiq) ?? (num(balance?.totalCashValue) != null && num(balance?.openPnL) != null ? num(balance?.totalCashValue)! + num(balance?.openPnL)! : null),
    availableMargin: num(balance?.netLiq) != null && num(balance?.initialMargin) != null ? num(balance?.netLiq)! - num(balance?.initialMargin)! : null,
    active: a.active !== false && a.archived !== true,
    metadata: { name: a.name, marginAccountType: a.marginAccountType ?? null, legalStatus: a.legalStatus ?? null },
  }
}

export function normalizeOrder(environment: string, o: TvOrder, specs: Map<number, InstrumentSpec>): NormalizedOrder {
  const spec = o.contractId != null ? specs.get(o.contractId) : undefined
  return {
    provider: "tradovate",
    environment,
    providerOrderId: String(o.id),
    providerAccountId: String(o.accountId),
    symbol: spec?.symbol ?? null,
    contractId: o.contractId != null ? String(o.contractId) : null,
    side: side(o.action),
    quantity: typeof o.orderQty === "number" ? o.orderQty : null,
    orderType: o.orderType ?? null,
    limitPrice: typeof o.price === "number" ? o.price : null,
    stopPrice: typeof o.stopPrice === "number" ? o.stopPrice : null,
    status: o.ordStatus ?? null,
    submittedAt: o.timestamp ? new Date(o.timestamp) : null,
    raw: o as Record<string, unknown>,
  }
}

export interface NormalizedFills {
  executions: NormalizedExecution[]
  unattributed: TvFill[] // order unknown yet
  unresolved: TvFill[] // contract unknown yet
}

export function normalizeFills(environment: string, fills: TvFill[], orderAccount: Map<number, number>, specs: Map<number, InstrumentSpec>, fees: Map<number, TvFillFee>): NormalizedFills {
  const out: NormalizedFills = { executions: [], unattributed: [], unresolved: [] }
  for (const f of fills) {
    const accountId = orderAccount.get(f.orderId)
    if (accountId == null) {
      out.unattributed.push(f)
      continue
    }
    const spec = specs.get(f.contractId)
    const s = side(f.action)
    if (!spec || !s) {
      out.unresolved.push(f)
      continue
    }
    out.executions.push({
      provider: "tradovate",
      environment,
      providerAccountId: String(accountId),
      providerExecutionId: String(f.id),
      providerOrderId: String(f.orderId),
      symbol: spec.symbol,
      contractMonth: spec.contractMonth,
      assetClass: spec.assetClass,
      side: s,
      quantity: f.qty,
      price: f.price,
      pointValue: spec.pointValue,
      timestamp: new Date(f.timestamp),
      commission: feeTotal(fees.get(f.id)),
      currency: "USD",
      active: f.active !== false,
      metadata: { contractId: f.contractId, tradeDate: f.tradeDate ?? null, finallyPaid: f.finallyPaid ?? null },
    })
  }
  return out
}

export function normalizePosition(environment: string, p: TvPosition, specs: Map<number, InstrumentSpec>): NormalizedPosition {
  return {
    provider: "tradovate",
    environment,
    providerAccountId: String(p.accountId),
    contractId: String(p.contractId),
    symbol: specs.get(p.contractId)?.symbol ?? null,
    netQuantity: p.netPos,
    averagePrice: typeof p.netPrice === "number" ? p.netPrice : null,
    updatedAt: p.timestamp ? new Date(p.timestamp) : null,
  }
}

// Reconciliation: which of the provider's executions we don't have yet, and
// which of ours the provider's current window no longer lists (older history
// ages out of Tradovate's lists — those are kept, just counted).
export function reconcileIds(localKeys: Iterable<string>, remoteKeys: Iterable<string>): { missing: string[]; notInRemoteWindow: number } {
  const local = new Set(localKeys)
  const remote = new Set(remoteKeys)
  const missing = [...remote].filter((k) => !local.has(k))
  let notInRemoteWindow = 0
  for (const k of local) if (!remote.has(k)) notInRemoteWindow++
  return { missing, notInRemoteWindow }
}
