// Standalone so both the Rithmic sync and the account editor can re-price
// trades without dragging in each other's (or rithmic-client's) heavy deps.
import { db } from "@/lib/db"
import { trades } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { computePnl, computeRMultiple } from "@/lib/calc"

// Re-prices every closed trade on the account so its P&L is net of commission:
// fees = ratePerContract × quantity, pnl = gross − fees. Gross is recomputed
// from the stored prices each time, so this is idempotent and safe to re-run
// (a rate of 0 clears the commission back to gross).
export async function repriceAccountTrades(accountId: number, ratePerContract: number): Promise<void> {
  const rows = await db.select().from(trades).where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
  for (const tr of rows) {
    if (tr.exitPrice == null) continue
    const qty = Number(tr.quantity)
    const base = {
      side: tr.side as "long" | "short",
      quantity: qty,
      entryPrice: Number(tr.entryPrice),
      exitPrice: Number(tr.exitPrice),
      contractMultiplier: Number(tr.contractMultiplier),
    }
    const fees = Number((ratePerContract * qty).toFixed(2))
    const pnl = computePnl({ ...base, fees: 0 }) - fees
    const rMultiple = computeRMultiple({ ...base, stopLoss: tr.stopLoss != null ? Number(tr.stopLoss) : null, fees })
    await db.update(trades).set({ fees: String(fees), pnl: String(pnl), rMultiple: rMultiple == null ? null : String(rMultiple) }).where(eq(trades.id, tr.id))
  }
}
