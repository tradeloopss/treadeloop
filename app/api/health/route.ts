import { pool } from "@/lib/db"

// Temporary diagnostic for the production database connection. Reports which
// step fails and the driver's own message — no connection string, password or
// host is ever returned. Delete this route once the deployment is healthy.
export async function GET() {
  const envPresent = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
    POSTGRES_PRISMA_URL: Boolean(process.env.POSTGRES_PRISMA_URL),
    POSTGRES_URL_NON_POOLING: Boolean(process.env.POSTGRES_URL_NON_POOLING),
    BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? null,
  }

  try {
    const ping = await pool.query("select 1 as ok")
    let tables: string[] = []
    try {
      const rows = await pool.query(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
      )
      tables = rows.rows.map((r: { table_name: string }) => r.table_name)
    } catch (error) {
      return Response.json({ step: "list-tables", envPresent, connected: true, error: String(error) }, { status: 500 })
    }
    return Response.json({
      step: "ok",
      envPresent,
      connected: ping.rows[0]?.ok === 1,
      tableCount: tables.length,
      tables,
    })
  } catch (error) {
    return Response.json(
      {
        step: "connect",
        envPresent,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        code: (error as { code?: string })?.code ?? null,
      },
      { status: 500 }
    )
  }
}
