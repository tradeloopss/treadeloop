import { headers } from "next/headers"
import { requireFeature } from "@/lib/features/server"
import { loadTrades, parseFilters, type Filters, type Loaded } from "@/lib/insights/data"
import { resolveTimeZone } from "@/lib/timezone"
import type { FeatureKey } from "@/lib/features/release"
import { DIMS, dimValues, parseConditionsParam, type Conditions, type DimId, type EdgeTrade } from "./core"

// What every Edge Lab and Psychology page starts from: who is asking (and that
// they may), the filters in the address, and the trades those leave.

export type SearchParams = Promise<Record<string, string | string[] | undefined>>

export type PageContext = { userId: string; isAdmin: boolean; filters: Filters; loaded: Loaded; trades: EdgeTrade[]; timeZone: string; conditions: Conditions; sp: Record<string, string | string[] | undefined> }

export async function insightPage(feature: FeatureKey, searchParams: SearchParams): Promise<PageContext> {
  const { userId, isAdmin } = await requireFeature(feature)
  const sp = await searchParams
  const filters = parseFilters(sp)
  const timeZone = resolveTimeZone(await headers())
  const loaded = await loadTrades(userId, filters, timeZone)
  // a slice handed over in the link (`?c=`)
  const conditions = parseConditionsParam(Array.isArray(sp.c) ? sp.c[0] : sp.c)
  return { userId, isAdmin, filters, loaded, trades: loaded.trades, timeZone, conditions, sp }
}

// What each dimension can be set to in these trades, most traded first.
export function dimOptions(trades: EdgeTrade[], cap = 40): Partial<Record<DimId, { value: string; n: number }[]>> {
  const out: Partial<Record<DimId, { value: string; n: number }[]>> = {}
  for (const d of DIMS) {
    const values = dimValues(trades, d.id)
    if (values.length) out[d.id] = values.slice(0, cap)
  }
  return out
}
