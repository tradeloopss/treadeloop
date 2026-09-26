import { createHash } from "node:crypto"
import type { NormalizedExecution } from "@/lib/providers/types"

// The key an execution is stored and de-duplicated by (UNIQUE per connection
// in provider_executions). The provider's own execution id when there is one;
// otherwise a deterministic hash of everything that identifies the fill — the
// timestamp alone is never trusted, since two partial fills of one order can
// share it.
export function executionKey(e: Pick<NormalizedExecution, "provider" | "environment" | "providerAccountId" | "providerExecutionId" | "providerOrderId" | "timestamp" | "symbol" | "side" | "quantity" | "price">): string {
  if (e.providerExecutionId) return `${e.provider}:${e.environment}:${e.providerExecutionId}`
  const parts = [e.provider, e.environment, e.providerAccountId, e.providerOrderId ?? "", e.timestamp.toISOString(), e.symbol, e.side, String(e.quantity), String(e.price)]
  return `${e.provider}:${e.environment}:h:${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40)}`
}

// Drops executions whose key was already seen — in this batch or before —
// keeping the first. Used before storage and before trade building, so a
// fill delivered twice (REST and realtime, or two reconnects) counts once.
export function dedupeExecutions<T extends NormalizedExecution>(executions: T[], seen: Set<string> = new Set()): T[] {
  const out: T[] = []
  for (const e of executions) {
    const key = executionKey(e)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}
