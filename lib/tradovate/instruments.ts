import type { TradovateApi } from "@/lib/tradovate/api"
import type { TvContract, TvContractMaturity, TvProduct } from "@/lib/tradovate/types"

// Instrument specifications for Tradovate contracts: symbol ("ESZ5"),
// contract month, product ("ES"), point value and tick size — straight from
// Tradovate's own contract → contractMaturity → product records, never from a
// hard-coded table. (lib/calc's contractMultiplierForSymbol is only the
// fallback for a product that doesn't report a point value.) Cached per
// environment for the life of the process; contracts don't change.

export interface InstrumentSpec {
  contractId: number
  symbol: string
  product: string | null
  contractMonth: string | null // "2025-12"
  pointValue: number | null
  tickSize: number | null
  assetClass: "future" | "option"
}

export function specFrom(contract: TvContract, maturity: TvContractMaturity | undefined, product: TvProduct | undefined): InstrumentSpec {
  const ym = maturity?.expirationMonth
  const contractMonth = typeof ym === "number" && ym > 190000 ? `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}` : null
  const optionLike = product?.productType ? /option/i.test(product.productType) : false
  return {
    contractId: contract.id,
    symbol: contract.name,
    product: product?.name ?? null,
    contractMonth,
    pointValue: typeof product?.valuePerPoint === "number" && product.valuePerPoint > 0 ? product.valuePerPoint : null,
    tickSize: typeof product?.tickSize === "number" ? product.tickSize : null,
    assetClass: optionLike ? "option" : "future",
  }
}

export class InstrumentCache {
  private specs = new Map<string, InstrumentSpec>()

  get(environment: string, contractId: number): InstrumentSpec | undefined {
    return this.specs.get(`${environment}:${contractId}`)
  }

  // Resolves every contract id not yet known, in three batched calls.
  async resolve(api: TradovateApi, contractIds: number[]): Promise<Map<number, InstrumentSpec>> {
    const missing = [...new Set(contractIds)].filter((id) => !this.specs.has(`${api.environment}:${id}`))
    if (missing.length > 0) {
      const contracts = await api.contracts(missing)
      const maturities = await api.maturities(contracts.map((c) => c.contractMaturityId).filter((n): n is number => typeof n === "number"))
      const products = await api.products(maturities.map((m) => m.productId))
      const maturityById = new Map(maturities.map((m) => [m.id, m]))
      const productById = new Map(products.map((p) => [p.id, p]))
      for (const c of contracts) {
        const m = c.contractMaturityId != null ? maturityById.get(c.contractMaturityId) : undefined
        this.specs.set(`${api.environment}:${c.id}`, specFrom(c, m, m ? productById.get(m.productId) : undefined))
      }
    }
    const out = new Map<number, InstrumentSpec>()
    for (const id of contractIds) {
      const spec = this.specs.get(`${api.environment}:${id}`)
      if (spec) out.set(id, spec)
    }
    return out
  }
}
