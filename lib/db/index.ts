import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

// DATABASE_URL is what local dev sets (scripts/db.mjs embedded Postgres).
// Hosted Postgres integrations inject their own names instead — Supabase and
// Vercel Postgres both set POSTGRES_URL — so accept those rather than
// requiring the value to be duplicated by hand in the dashboard.
// POSTGRES_URL is the pooled connection, which is the right one for
// serverless; the non-pooling variant is only a last resort.
function connectionString(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  )
}

const raw = connectionString()

if (!raw && process.env.NODE_ENV === "production") {
  // Fail loudly at boot with the fix, instead of a 500 on every page that
  // touches the database.
  throw new Error(
    "No Postgres connection string. Set DATABASE_URL (or POSTGRES_URL) in the deployment's environment variables."
  )
}

const isLocal = !raw || raw.includes("localhost") || raw.includes("127.0.0.1")

// Supabase's connection string carries `sslmode=require`, and current pg
// treats that as `verify-full` — which fails against the pooler, since it
// serves a certificate that doesn't match the connection host ("self signed
// certificate in certificate chain"). A `ssl` option alone doesn't help: the
// mode parsed out of the URL wins. So the parameter is stripped from the
// string and TLS is configured explicitly here instead. The connection is
// still encrypted; only the certificate chain check is relaxed, which is the
// documented way to reach a Supabase pooler from node-postgres.
function withoutSslMode(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete("sslmode")
    parsed.searchParams.delete("ssl")
    return parsed.toString()
  } catch {
    return url
  }
}

export const pool = new Pool({
  connectionString: raw && !isLocal ? withoutSslMode(raw) : raw,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
})

export const db = drizzle(pool, { schema })
