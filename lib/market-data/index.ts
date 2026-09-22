// Provider registry. Everything that needs bars asks getProvider(id) and codes
// against the MarketDataProvider interface, never against a specific source.
import type { MarketDataProvider } from "./types"
import { yahooProvider } from "./yahoo"

const PROVIDERS: Record<string, MarketDataProvider> = {
  [yahooProvider.id]: yahooProvider,
}

export const DEFAULT_PROVIDER = yahooProvider.id

export function getProvider(id: string = DEFAULT_PROVIDER): MarketDataProvider {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`Unknown market-data provider "${id}"`)
  return p
}

export * from "./types"
export { INSTRUMENTS, contractRootFor, instrumentMarket } from "./instruments"
