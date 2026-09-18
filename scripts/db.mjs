// Local embedded Postgres for dev — no Homebrew/Docker required.
// Data lives in .pgdata/ (gitignored). Run with: node scripts/db.mjs
import EmbeddedPostgres from "embedded-postgres"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, "..", ".pgdata")

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
})

const fs = await import("node:fs")
const isNew = !fs.existsSync(path.join(dataDir, "PG_VERSION"))

if (isNew) {
  await pg.initialise()
}
await pg.start()
if (isNew) {
  await pg.createDatabase("tradeloop1")
}

console.log("Postgres ready on port 5432 (db: tradeloop1)")

const shutdown = async () => {
  await pg.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
