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

const url = connectionString()

if (!url && process.env.NODE_ENV === "production") {
  // Fail loudly at boot with the fix, instead of a 500 on every page that
  // touches the database.
  throw new Error(
    "No Postgres connection string. Set DATABASE_URL (or POSTGRES_URL) in the deployment's environment variables."
  )
}

export const pool = new Pool({
  connectionString: url,
  // Hosted Postgres requires TLS, and Supabase's pooler presents a
  // certificate that doesn't match the connection host, which node-postgres
  // rejects by default. Local dev has no TLS at all.
  ssl: url && !url.includes("localhost") && !url.includes("127.0.0.1") ? { rejectUnauthorized: false } : undefined,
})

export const db = drizzle(pool, { schema })
