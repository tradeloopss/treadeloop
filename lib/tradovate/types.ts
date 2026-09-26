// Tradovate API entities, as far as TradeLoop reads them. Fields Tradovate
// may omit are optional; everything is read defensively in normalize.ts.

export interface TvAccount {
  id: number
  name: string
  nickname?: string | null
  userId?: number
  accountType?: string // "Customer" | "Giveup" | "House" | "Omnibus" | "Wash"
  active?: boolean
  archived?: boolean
  marginAccountType?: string // "Speculator" | "Hedger"
  legalStatus?: string
  riskCategoryId?: number
  timestamp?: string
}

export interface TvCashBalance {
  accountId: number
  totalCashValue?: number
  netLiq?: number
  totalPnL?: number
  openPnL?: number
  realizedPnL?: number
  weekRealizedPnL?: number
  initialMargin?: number
  maintenanceMargin?: number
  currencyId?: number
  errorText?: string
}

export interface TvOrder {
  id: number
  accountId: number
  contractId?: number
  timestamp?: string
  action?: "Buy" | "Sell"
  ordStatus?: string // "Working" | "Filled" | "Canceled" | "Rejected" | …
  orderType?: string
  orderQty?: number
  price?: number
  stopPrice?: number
  archived?: boolean
  [key: string]: unknown
}

export interface TvFill {
  id: number
  orderId: number
  contractId: number
  timestamp: string
  tradeDate?: { year: number; month: number; day: number }
  action: "Buy" | "Sell"
  qty: number
  price: number
  active: boolean
  finallyPaid?: boolean
}

// Fees on one fill (its id is the fill's id).
export interface TvFillFee {
  id: number
  clearingFee?: number
  exchangeFee?: number
  nfaFee?: number
  brokerageFee?: number
  ipFee?: number
  commission?: number
  orderRoutingFee?: number
}

export interface TvPosition {
  id: number
  accountId: number
  contractId: number
  timestamp?: string
  netPos: number
  netPrice?: number
  bought?: number
  boughtValue?: number
  sold?: number
  soldValue?: number
}

export interface TvContract {
  id: number
  name: string // "ESZ5"
  contractMaturityId?: number
}

export interface TvContractMaturity {
  id: number
  productId: number
  expirationMonth?: number // yyyymm, e.g. 202512
  expirationDate?: string
}

export interface TvProduct {
  id: number
  name: string // "ES"
  productType?: string // "Futures" | "Options" | …
  valuePerPoint?: number
  tickSize?: number
  currencyId?: number
}

export interface TvMe {
  userId: number
  name?: string
  fullName?: string
}
