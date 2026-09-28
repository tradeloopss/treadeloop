// The trade fields a CSV column can map onto. Kept in a plain module (not the
// "use server" actions file, which may only export async functions) so both
// the server actions and the client editor can import it.
export const CSV_TARGET_FIELDS = [
  "symbol",
  "side",
  "quantity",
  "entryPrice",
  "exitPrice",
  "entryTime",
  "exitTime",
  "pnl",
  "fees",
] as const

export type CsvTargetField = (typeof CSV_TARGET_FIELDS)[number]
