// Structured logs for the Tradovate integration — one JSON line per event:
//   {"provider":"tradovate","event":"execution_received","connectionId":12,…}
// Anything that looks like a credential is dropped, whatever the caller
// passes, so tokens, secrets and passwords can't reach the logs.

const SECRET_KEY = /token|secret|password|authorization|cookie|p-ticket|code_verifier/i

function clean(v: unknown, depth: number): unknown {
  if (v instanceof Error) return v.message
  if (v instanceof Date) return v.toISOString()
  if (depth > 4) return "[…]"
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1))
  if (v && typeof v === "object") return redactAt(v as Record<string, unknown>, depth + 1)
  if (typeof v === "string" && /^bearer\s/i.test(v)) return "[redacted]"
  return v
}

function redactAt(fields: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY.test(k)) continue
    out[k] = clean(v, depth)
  }
  return out
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  return redactAt(fields, 0)
}

export function tlog(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({ provider: "tradovate", event, ...redact(fields), at: new Date().toISOString() })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}
