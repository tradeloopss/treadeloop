import type { ProviderIdentity, ProviderTokens } from "@/lib/providers/types"
import type { TradovateApi } from "@/lib/tradovate/api"
import type { TvAccount, TvCashBalance, TvContract, TvContractMaturity, TvFill, TvFillFee, TvOrder, TvPosition, TvProduct } from "@/lib/tradovate/types"

// TRADOVATE_MODE=mock: fixture data shaped exactly like Tradovate's API, with
// no network at all. Used by local development and the tests. Two demo
// accounts (a prop-style evaluation and a sim account) and one live account:
//   APEX-50K   ES  BUY 2 @ 6500, BUY 1 @ 6502, SELL 3 @ 6505  → one long trade, 3 contracts
//              NQ  SELL 1 @ 21000, BUY 1 @ 20980            → one short trade
//   SIM-1      MES BUY 1 @ 6500, SELL 2 @ 6490, BUY 1 @ 6480 → a long, then a short (flip)
//   live 7001  ES  open long 1 (no closing fill yet)
// Fill 1002 is delivered twice by design, to exercise de-duplication.

export const MOCK_IDENTITY: ProviderIdentity = { providerUserId: "900001", name: "Mock Trader" }

export function mockTokens(now = new Date()): ProviderTokens {
  return {
    accessToken: "mock-access-token",
    accessExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    refreshToken: "mock-refresh-token",
    refreshExpiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  }
}

const day = (d: string) => new Date(`${d}Z`).toISOString()

const PRODUCTS: TvProduct[] = [
  { id: 1, name: "ES", productType: "Futures", valuePerPoint: 50, tickSize: 0.25 },
  { id: 2, name: "NQ", productType: "Futures", valuePerPoint: 20, tickSize: 0.25 },
  { id: 3, name: "MES", productType: "Futures", valuePerPoint: 5, tickSize: 0.25 },
]
const MATURITIES: TvContractMaturity[] = [
  { id: 11, productId: 1, expirationMonth: 202512 },
  { id: 12, productId: 2, expirationMonth: 202512 },
  { id: 13, productId: 3, expirationMonth: 202512 },
]
const CONTRACTS: TvContract[] = [
  { id: 101, name: "ESZ5", contractMaturityId: 11 },
  { id: 102, name: "NQZ5", contractMaturityId: 12 },
  { id: 103, name: "MESZ5", contractMaturityId: 13 },
]

const DATA: Record<"demo" | "live", { accounts: TvAccount[]; orders: TvOrder[]; fills: TvFill[]; fees: TvFillFee[]; positions: TvPosition[]; balances: TvCashBalance[] }> = {
  demo: {
    accounts: [
      { id: 5001, name: "APEX-50K-0001", accountType: "Customer", active: true, userId: 900001 },
      { id: 5002, name: "SIM-1", accountType: "Customer", active: true, userId: 900001 },
    ],
    orders: [
      { id: 2001, accountId: 5001, contractId: 101, action: "Buy", ordStatus: "Filled", orderType: "Market", orderQty: 2, timestamp: day("2025-11-03T14:30:00") },
      { id: 2002, accountId: 5001, contractId: 101, action: "Buy", ordStatus: "Filled", orderType: "Limit", orderQty: 1, price: 6502, timestamp: day("2025-11-03T14:31:00") },
      { id: 2003, accountId: 5001, contractId: 101, action: "Sell", ordStatus: "Filled", orderType: "Limit", orderQty: 3, price: 6505, timestamp: day("2025-11-03T14:40:00") },
      { id: 2004, accountId: 5001, contractId: 102, action: "Sell", ordStatus: "Filled", orderType: "Market", orderQty: 1, timestamp: day("2025-11-03T15:00:00") },
      { id: 2005, accountId: 5001, contractId: 102, action: "Buy", ordStatus: "Filled", orderType: "Stop", orderQty: 1, stopPrice: 20980, timestamp: day("2025-11-03T15:05:00") },
      { id: 2006, accountId: 5002, contractId: 103, action: "Buy", ordStatus: "Filled", orderType: "Market", orderQty: 1, timestamp: day("2025-11-04T14:30:00") },
      { id: 2007, accountId: 5002, contractId: 103, action: "Sell", ordStatus: "Filled", orderType: "Market", orderQty: 2, timestamp: day("2025-11-04T14:45:00") },
      { id: 2008, accountId: 5002, contractId: 103, action: "Buy", ordStatus: "Filled", orderType: "Market", orderQty: 1, timestamp: day("2025-11-04T15:00:00") },
      { id: 2009, accountId: 5002, contractId: 103, action: "Buy", ordStatus: "Working", orderType: "Limit", orderQty: 1, price: 6400, timestamp: day("2025-11-04T15:01:00") },
    ],
    fills: [
      { id: 1001, orderId: 2001, contractId: 101, timestamp: day("2025-11-03T14:30:00.120"), action: "Buy", qty: 2, price: 6500, active: true },
      { id: 1002, orderId: 2002, contractId: 101, timestamp: day("2025-11-03T14:31:04.500"), action: "Buy", qty: 1, price: 6502, active: true },
      { id: 1002, orderId: 2002, contractId: 101, timestamp: day("2025-11-03T14:31:04.500"), action: "Buy", qty: 1, price: 6502, active: true }, // duplicate delivery
      { id: 1003, orderId: 2003, contractId: 101, timestamp: day("2025-11-03T14:40:10.000"), action: "Sell", qty: 3, price: 6505, active: true },
      { id: 1004, orderId: 2004, contractId: 102, timestamp: day("2025-11-03T15:00:01.000"), action: "Sell", qty: 1, price: 21000, active: true },
      { id: 1005, orderId: 2005, contractId: 102, timestamp: day("2025-11-03T15:05:30.000"), action: "Buy", qty: 1, price: 20980, active: true },
      { id: 1099, orderId: 2005, contractId: 102, timestamp: day("2025-11-03T15:05:31.000"), action: "Buy", qty: 1, price: 20979, active: false }, // busted fill — ignored
      { id: 1006, orderId: 2006, contractId: 103, timestamp: day("2025-11-04T14:30:00.000"), action: "Buy", qty: 1, price: 6500, active: true },
      { id: 1007, orderId: 2007, contractId: 103, timestamp: day("2025-11-04T14:45:00.000"), action: "Sell", qty: 2, price: 6490, active: true },
      { id: 1008, orderId: 2008, contractId: 103, timestamp: day("2025-11-04T15:00:00.000"), action: "Buy", qty: 1, price: 6480, active: true },
    ],
    fees: [
      { id: 1001, commission: 1.58, exchangeFee: 2.28, clearingFee: 0.2, nfaFee: 0.04 },
      { id: 1002, commission: 0.79, exchangeFee: 1.14, clearingFee: 0.1, nfaFee: 0.02 },
      { id: 1003, commission: 2.37, exchangeFee: 3.42, clearingFee: 0.3, nfaFee: 0.06 },
      { id: 1004, commission: 0.79, exchangeFee: 1.14 },
      { id: 1005, commission: 0.79, exchangeFee: 1.14 },
      { id: 1006, commission: 0.25, exchangeFee: 0.35 },
      { id: 1007, commission: 0.5, exchangeFee: 0.7 },
      { id: 1008, commission: 0.25, exchangeFee: 0.35 },
    ],
    positions: [],
    balances: [
      { accountId: 5001, totalCashValue: 50600.5, netLiq: 50600.5, realizedPnL: 600.5, openPnL: 0 },
      { accountId: 5002, totalCashValue: 100045.75, netLiq: 100045.75, realizedPnL: 45.75, openPnL: 0 },
    ],
  },
  live: {
    accounts: [{ id: 7001, name: "LIVE-7001", accountType: "Customer", active: true, userId: 900001 }],
    orders: [{ id: 3001, accountId: 7001, contractId: 101, action: "Buy", ordStatus: "Filled", orderType: "Market", orderQty: 1, timestamp: day("2025-11-05T14:30:00") }],
    fills: [{ id: 4001, orderId: 3001, contractId: 101, timestamp: day("2025-11-05T14:30:00.050"), action: "Buy", qty: 1, price: 6510, active: true }],
    fees: [{ id: 4001, commission: 0.79, exchangeFee: 1.14 }],
    positions: [{ id: 8001, accountId: 7001, contractId: 101, netPos: 1, netPrice: 6510, timestamp: day("2025-11-05T14:30:00") }],
    balances: [{ accountId: 7001, totalCashValue: 25000, netLiq: 25012.5, openPnL: 12.5 }],
  },
}

// A mock environment. `extraFills` lets tests append new executions to
// simulate trades placed after the first sync (for reconciliation).
export function mockTradovateApi(environment: "demo" | "live", extra: { fills?: TvFill[]; orders?: TvOrder[]; fees?: TvFillFee[] } = {}): TradovateApi {
  const d = DATA[environment]
  const fills = [...d.fills, ...(extra.fills ?? [])]
  const orders = [...d.orders, ...(extra.orders ?? [])]
  const fees = [...d.fees, ...(extra.fees ?? [])]
  const pick = <T extends { id: number }>(all: T[], ids: number[]) => all.filter((x) => ids.includes(x.id))
  return {
    environment,
    accounts: async () => d.accounts,
    cashBalance: async (accountId) => d.balances.find((b) => b.accountId === accountId) ?? null,
    positions: async () => d.positions,
    orders: async () => orders,
    order: async (id) => orders.find((o) => o.id === id) ?? null,
    fills: async () => fills,
    fillFees: async (ids) => pick(fees, ids),
    contracts: async (ids) => pick(CONTRACTS, ids),
    maturities: async (ids) => pick(MATURITIES, ids),
    products: async (ids) => pick(PRODUCTS, ids),
  }
}
