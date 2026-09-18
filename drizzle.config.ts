import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Same fallbacks as lib/db/index.ts, so `drizzle-kit push` can target the
    // hosted database using whatever variable the provider injected. Prefer
    // the non-pooling URL here: migrations run DDL, which pgbouncer's
    // transaction pooling doesn't handle.
    url: (process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL)!,
  },
})
