import { ExternalLink } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { getApiUsage, getDatabaseHealth, getRouteTimings } from "@/lib/admin/metrics"
import { AdminPageHeader, EmptyRow, Panel, StatRow, StatTile, fmtAgo, fmtBytes, fmtNumber } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

const PROVIDER_LABELS: Record<string, string> = { anthropic: "Anthropic (journal AI)", metaapi: "MetaApi (MetaTrader)" }
const ms = (v: number) => (v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`)
const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`)

export default async function AdminSystemPage() {
  await requireAdmin({ security: ["view"] })
  const [dbHealth, timings, api] = await Promise.all([getDatabaseHealth(), getRouteTimings(), getApiUsage()])
  const anthropicCost = api.usage.filter((u) => u.provider === "anthropic").reduce((sum, u) => sum + (u.estimatedCostUsd ?? 0), 0)
  const slowest = timings[0]
  const connectionShare = dbHealth.maxConnections ? dbHealth.connections / dbHealth.maxConnections : 0

  return (
    <div>
      <AdminPageHeader
        title="System"
        description="Database health, how long pages take to render on the server, and what the app spends on outside APIs."
        action={
          <a href="https://vercel.com/trade-loop/treadeloop/observability" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            CPU, memory &amp; errors in Vercel <ExternalLink className="size-3.5" />
          </a>
        }
      />
      <div className="space-y-6 p-4 sm:p-6">
        <StatRow>
          <StatTile label="Database size" value={dbHealth.size} note={dbHealth.version} />
          <StatTile
            label="Open connections"
            value={`${dbHealth.connections} / ${dbHealth.maxConnections}`}
            note={connectionShare > 0.8 ? "near the limit" : "of the server's limit"}
          />
          <StatTile label="Slowest page, p95" value={slowest ? ms(slowest.p95) : "—"} note={slowest ? `${slowest.route} · ${slowest.samples} samples` : "no timings yet"} />
          <StatTile label="AI spend, 30 days" value={usd(anthropicCost)} note="journal narratives, at list price" />
          <StatTile label="API errors, 30 days" value={fmtNumber(api.usage.reduce((sum, u) => sum + u.errors, 0))} note={`of ${fmtNumber(api.usage.reduce((sum, u) => sum + u.calls, 0))} calls`} />
        </StatRow>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Page render time, last 24h" description="Server time to build each page, sampled on 1 in 4 requests. Doesn't include the network or the browser.">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Route</th>
                  <th className="pb-2 text-end font-medium">p50</th>
                  <th className="pb-2 text-end font-medium">p95</th>
                  <th className="pb-2 text-end font-medium">Max</th>
                  <th className="pb-2 text-end font-medium">Samples</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {timings.map((t) => (
                  <tr key={t.route}>
                    <td className="py-2 pe-3 font-mono text-xs">{t.route}</td>
                    <td className="py-2 text-end tabular-nums">{ms(t.p50)}</td>
                    <td className={cn("py-2 text-end tabular-nums", t.p95 > 2000 && "text-[var(--loss)]", t.p95 > 1000 && t.p95 <= 2000 && "text-[var(--chart-4)]")}>{ms(t.p95)}</td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground">{ms(t.max)}</td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground">{t.samples}</td>
                  </tr>
                ))}
                {timings.length === 0 && <EmptyRow colSpan={5}>No page timings recorded in the last 24 hours.</EmptyRow>}
              </tbody>
            </table>
          </Panel>

          <Panel title="Largest tables" description="Size on disk including indexes. Many sequential scans on a big table usually means a missing index.">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Table</th>
                  <th className="pb-2 text-end font-medium">Rows</th>
                  <th className="pb-2 text-end font-medium">Size</th>
                  <th className="pb-2 text-end font-medium">Seq / idx scans</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dbHealth.tables.map((t) => (
                  <tr key={t.table}>
                    <td className="py-2 pe-3 font-mono text-xs">{t.table}</td>
                    <td className="py-2 text-end tabular-nums">{fmtNumber(t.rows)}</td>
                    <td className="py-2 text-end tabular-nums">{t.total}</td>
                    <td className={cn("py-2 text-end tabular-nums text-muted-foreground", t.rows > 10_000 && t.seqScans > (t.idxScans ?? 0) && "text-[var(--chart-4)]")}>
                      {fmtNumber(t.seqScans)} / {t.idxScans == null ? "—" : fmtNumber(t.idxScans)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <Panel title="Slowest database statements" description="Average execution time per statement since the database's statistics were last reset (pg_stat_statements).">
          {dbHealth.slowQueries == null ? (
            <p className="text-sm text-muted-foreground">Statement statistics aren&apos;t available on this database (the pg_stat_statements extension is off). Supabase enables it by default in production.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Statement</th>
                  <th className="pb-2 text-end font-medium">Calls</th>
                  <th className="pb-2 text-end font-medium">Mean</th>
                  <th className="pb-2 text-end font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dbHealth.slowQueries.map((s, i) => (
                  <tr key={i}>
                    <td className="max-w-[560px] truncate py-2 pe-3 font-mono text-xs" title={s.query}>{s.query}</td>
                    <td className="py-2 text-end tabular-nums">{fmtNumber(s.calls)}</td>
                    <td className={cn("py-2 text-end tabular-nums", s.meanMs > 500 && "text-[var(--loss)]")}>{s.meanMs} ms</td>
                    <td className="py-2 text-end tabular-nums text-muted-foreground">{ms(s.totalMs)}</td>
                  </tr>
                ))}
                {dbHealth.slowQueries.length === 0 && <EmptyRow colSpan={4}>No statement has run more than 5 times yet.</EmptyRow>}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Outside APIs, last 30 days" description="Every call the app makes to Anthropic and MetaApi. Anthropic cost is estimated from tokens at list price; MetaApi is a flat subscription.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 font-medium">Operation</th>
                <th className="pb-2 text-end font-medium">Calls</th>
                <th className="pb-2 text-end font-medium">Errors</th>
                <th className="pb-2 text-end font-medium">Tokens in / out</th>
                <th className="pb-2 text-end font-medium">Avg time</th>
                <th className="pb-2 text-end font-medium">Est. cost</th>
                <th className="pb-2 text-end font-medium">Last call</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {api.usage.map((u) => (
                <tr key={`${u.provider}-${u.operation}`}>
                  <td className="py-2 pe-3">{PROVIDER_LABELS[u.provider] ?? u.provider}</td>
                  <td className="py-2 pe-3 font-mono text-xs">{u.operation}</td>
                  <td className="py-2 text-end tabular-nums">{fmtNumber(u.calls)}</td>
                  <td className={cn("py-2 text-end tabular-nums", u.errors > 0 && "text-[var(--loss)]")}>{fmtNumber(u.errors)}</td>
                  <td className="py-2 text-end tabular-nums text-muted-foreground">{u.provider === "anthropic" ? `${fmtNumber(u.inputTokens)} / ${fmtNumber(u.outputTokens)}` : "—"}</td>
                  <td className="py-2 text-end tabular-nums text-muted-foreground">{u.avgMs == null ? "—" : ms(u.avgMs)}</td>
                  <td className="py-2 text-end tabular-nums">{u.estimatedCostUsd == null ? "—" : usd(u.estimatedCostUsd)}</td>
                  <td className="py-2 text-end text-muted-foreground">{fmtAgo(u.last)}</td>
                </tr>
              ))}
              {api.usage.length === 0 && <EmptyRow colSpan={8}>No outside API calls recorded yet.</EmptyRow>}
            </tbody>
          </table>
          {api.recentErrors.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Latest errors</p>
              <ul className="space-y-1 text-xs">
                {api.recentErrors.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground">{fmtAgo(e.createdAt)}</span>
                    <span className="shrink-0 font-mono">{e.provider}/{e.operation}</span>
                    <span className="truncate text-[var(--loss)]" title={e.error ?? undefined}>{e.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
        <p className="text-xs text-muted-foreground">Total database size includes indexes: {fmtBytes(dbHealth.sizeBytes)}.</p>
      </div>
    </div>
  )
}
