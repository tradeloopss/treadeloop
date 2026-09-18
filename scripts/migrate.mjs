// Applies pending SQL migrations from ./drizzle to the hosted database. Runs
// as the first step of `pnpm build`, so a Vercel deploy brings the database
// schema up to date before the new code goes live — a deploy against an empty
// database otherwise 500s on every auth request ("missing tables user,
// session, account, verification"). A failed migration fails the build, which
// leaves the previous deployment serving.
//
// Off Vercel this is a no-op: local dev creates its tables with
// `drizzle-kit push` against the embedded Postgres (scripts/db.mjs), which
// keeps no migration history, so replaying migrations there would collide
// with tables that already exist.
//
// To change the schema: edit lib/db/schema.ts, run `drizzle-kit generate`,
// and commit the new file in ./drizzle.
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

if (!process.env.VERCEL) {
  console.log("[migrate] skipped: not a Vercel build")
  process.exit(0)
}

// Same variables lib/db/index.ts accepts. The non-pooling URL comes first
// because DDL belongs on a direct session; the pooled ones are fallbacks for
// when the direct host isn't reachable from the build (Supabase's direct host
// is IPv6-only).
const candidates = [
  ["POSTGRES_URL_NON_POOLING", process.env.POSTGRES_URL_NON_POOLING],
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["POSTGRES_URL", process.env.POSTGRES_URL],
].filter(([, url]) => url)

if (candidates.length === 0) {
  // Preview deployments have no database configured.
  console.log("[migrate] skipped: no database URL in this environment")
  process.exit(0)
}

// Mirrors lib/db/index.ts: hosted URLs carry `sslmode=require`, which pg reads
// as verify-full and which then fails against the Supabase pooler's
// certificate. Strip it and configure TLS explicitly instead.
function clientFor(url) {
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1")
  let connectionString = url
  if (!isLocal) {
    try {
      const parsed = new URL(url)
      parsed.searchParams.delete("sslmode")
      parsed.searchParams.delete("ssl")
      connectionString = parsed.toString()
    } catch {}
  }
  return new pg.Client({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  })
}

let client
for (const [name, url] of candidates) {
  const attempt = clientFor(url)
  try {
    await attempt.connect()
    client = attempt
    console.log(`[migrate] connected via ${name}`)
    break
  } catch (error) {
    console.warn(`[migrate] could not connect via ${name}: ${error.message}`)
  }
}

if (!client) {
  console.error("[migrate] no database URL was reachable; aborting build")
  process.exit(1)
}

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" })
  console.log("[migrate] database schema is up to date")
} catch (error) {
  console.error("[migrate] failed:", error)
  process.exitCode = 1
} finally {
  await client.end()
}
