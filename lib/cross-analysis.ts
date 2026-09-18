// Symbol × month net P&L breakdown for the Reports page "Cross Analysis"
// heatmap — aggregates by calendar month across all years in the data.
export interface CrossAnalysisTrade {
  symbol: string
  pnl: number
  entryTime: string | Date
  exitTime?: string | Date | null
  status: string
}

export interface CrossAnalysisRow {
  symbol: string
  values: number[] // length 12, index 0 = January
}

export interface CrossAnalysisResult {
  rows: CrossAnalysisRow[]
  maxGain: number
  maxLoss: number // positive magnitude of the largest losing cell
}

export function computeCrossAnalysis(trades: CrossAnalysisTrade[]): CrossAnalysisResult {
  const closed = trades.filter((t) => t.status === "closed")
  const bySymbol = new Map<string, number[]>()
  for (const t of closed) {
    const month = new Date(t.exitTime ?? t.entryTime).getMonth()
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, new Array(12).fill(0))
    bySymbol.get(t.symbol)![month] += t.pnl
  }

  const rows: CrossAnalysisRow[] = Array.from(bySymbol.entries())
    .map(([symbol, values]) => ({ symbol, values: values.map((v) => Number(v.toFixed(2))) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))

  let maxGain = 0
  let maxLoss = 0
  for (const row of rows) {
    for (const v of row.values) {
      if (v > maxGain) maxGain = v
      if (v < -maxLoss) maxLoss = -v
    }
  }

  return { rows, maxGain, maxLoss }
}
