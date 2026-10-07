import type { Metadata } from "next"
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm"
import { Check, X } from "lucide-react"
import { db } from "@/lib/db"
import { copyEvents, metatraderConnections, user } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { detectProvider, providerProfile } from "@/lib/compliance/engine"
import { ruleSetHistory, ruleSets } from "@/lib/compliance/server"
import { AdminPageHeader, Panel, fmtDate, fmtDateTime } from "@/components/admin/ui"
import { IntegrationBadge } from "@/components/compliance/safe-mode"
import { RulesForm } from "@/components/admin/providers/rules-form"

export const metadata: Metadata = { title: "Provider rules — TradeLoop admin" }

// What TradeLoop can do on each trading platform today, said as it is: no
// integration is listed as working that isn't.
const PLATFORMS: { name: string; status: "supported" | "unavailable"; sync: string; lead: string; orders: string }[] = [
  { name: "MetaTrader 5", status: "supported", sync: "Yes", lead: "Yes, instantly", orders: "Yes, with the trading password" },
  { name: "MetaTrader 4", status: "supported", sync: "Yes", lead: "Yes", orders: "Not yet" },
  { name: "Rithmic", status: "supported", sync: "Yes", lead: "Yes", orders: "Not yet" },
  { name: "Tradovate (through NinjaTrader)", status: "supported", sync: "Yes", lead: "Yes", orders: "Not yet" },
  { name: "cTrader", status: "unavailable", sync: "No", lead: "No", orders: "No" },
  { name: "Match-Trader", status: "unavailable", sync: "No", lead: "No", orders: "No" },
]

// The rules of each broker or prop firm that has rules of its own, in force
// and as they were; who published which version; and what they have stopped.
export default async function AdminProvidersPage() {
  const admin = await requireAdmin({ brokers: ["view"] })
  const canPublish = roleCan(admin.role, { team: ["manage"] })
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [sets, servers, blocks, recent] = await Promise.all([
    ruleSets(),
    db.select({ server: metatraderConnections.server, n: sql<number>`count(*)::int` }).from(metatraderConnections).where(isNotNull(metatraderConnections.accountId)).groupBy(metatraderConnections.server),
    db.select({ provider: sql<string | null>`${copyEvents.data}->>'provider'`, reasonCode: sql<string | null>`${copyEvents.data}->>'reasonCode'`, n: sql<number>`count(*)::int` }).from(copyEvents).where(and(eq(copyEvents.code, "compliance_blocked"), gte(copyEvents.createdAt, since))).groupBy(sql`1`, sql`2`),
    db
      .select({ id: copyEvents.id, body: copyEvents.body, data: copyEvents.data, createdAt: copyEvents.createdAt, email: user.email })
      .from(copyEvents)
      .leftJoin(user, eq(user.id, copyEvents.userId))
      .where(eq(copyEvents.code, "compliance_blocked"))
      .orderBy(desc(copyEvents.createdAt))
      .limit(30),
  ])
  const histories = await Promise.all(sets.map((s) => ruleSetHistory(s.provider)))

  return (
    <div>
      <AdminPageHeader title="Provider rules" description="What each broker or prop firm lets a copier do with its accounts. The connection forms and the copy engine apply the version in force; a new version is published here, never edited in place." />
      <div className="space-y-6 p-4 sm:p-6">
        {sets.map((set, i) => {
          const profile = providerProfile(set)
          const connected = servers.filter((s) => detectProvider([set], s.server)).reduce((n, s) => n + s.n, 0)
          const stopped = blocks.filter((b) => b.provider === set.name)
          const r = set.rules
          return (
            <Panel key={set.provider} title={set.name} description={`Rules v${set.version} · effective ${fmtDate(set.effectiveDate)} · recognised by server names containing “${set.servers.join("”, “")}”`} action={<IntegrationBadge status={profile.status} label={profile.statusLabel} />}>
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <ul className="space-y-1.5 text-sm">
                    {profile.lines.map((line) => (
                      <li key={line.key} className="flex items-center gap-2">
                        {line.allowed ? <Check className="size-4 shrink-0 text-[var(--gain)]" aria-hidden /> : <X className="size-4 shrink-0 text-[var(--loss)]" aria-hidden />}
                        <span>{line.label}</span>
                        <span className="ms-auto text-xs text-muted-foreground">{line.allowed ? "Allowed" : "Blocked"}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Master credential</dt>
                    <dd>{profile.masterCredential}</dd>
                    <dt className="text-muted-foreground">Orders by TradeLoop</dt>
                    <dd>{r.execution === "allowed" ? "Allowed" : "Blocked"}</dd>
                    <dt className="text-muted-foreground">Own → own needs proof of ownership</dt>
                    <dd>{r.ownershipProof === "required" ? "Yes (TradeLoop has none, so it stays off)" : "No"}</dd>
                    <dt className="text-muted-foreground">Third-party EAs</dt>
                    <dd className="capitalize">{r.thirdPartyEa}</dd>
                    <dt className="text-muted-foreground">Maximum allocation</dt>
                    <dd className="tabular-nums">{r.maxAllocation == null ? "None" : `$${r.maxAllocation.toLocaleString("en-US")}`}</dd>
                    <dt className="text-muted-foreground">Accounts connected</dt>
                    <dd className="tabular-nums">{connected}</dd>
                    <dt className="text-muted-foreground">Stopped, last 30 days</dt>
                    <dd className="tabular-nums">{stopped.reduce((n, b) => n + b.n, 0)}{stopped.length > 0 && <span className="text-xs text-muted-foreground"> ({stopped.map((b) => `${b.reasonCode} ${b.n}`).join(" · ")})</span>}</dd>
                  </dl>
                  {r.notes.length > 0 && (
                    <ul className="mt-4 list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                      {r.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-4 text-xs text-muted-foreground">
                    Sources:{" "}
                    {set.sources.map((s, j) => (
                      <span key={s.url}>
                        {j > 0 && " · "}
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                          {s.label}
                        </a>
                      </span>
                    ))}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Versions</p>
                  <ul className="mt-2 divide-y text-sm">
                    {histories[i].map((v) => (
                      <li key={v.version} className="py-2">
                        <p className="flex flex-wrap items-center gap-x-2">
                          <span className="font-medium tabular-nums">v{v.version}</span>
                          {v.version === set.version && <span className="rounded-full border px-1.5 text-[10px] font-semibold tracking-wide uppercase">In force</span>}
                          <span className="text-xs text-muted-foreground">
                            effective {fmtDate(v.ruleSet.effectiveDate)} · {v.publishedByEmail} · {fmtDateTime(v.createdAt)}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{v.ruleSet.note}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {canPublish ? (
                <details className="mt-5 rounded-lg border">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Publish a new version</summary>
                  <div className="border-t p-4">
                    <RulesForm set={set} />
                  </div>
                </details>
              ) : (
                <p className="mt-5 text-xs text-muted-foreground">Publishing a new version needs the Team &amp; roles permission.</p>
              )}
            </Panel>
          )
        })}

        <Panel title="Platform integrations" description="What TradeLoop does on each platform today. A broker or prop firm with no rules of its own above is connected on these terms alone.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="py-1.5 text-start font-medium">Platform</th>
                  <th className="py-1.5 text-start font-medium">Status</th>
                  <th className="py-1.5 text-start font-medium">Auto-sync</th>
                  <th className="py-1.5 text-start font-medium">Master</th>
                  <th className="py-1.5 text-start font-medium">Receives orders</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {PLATFORMS.map((p) => (
                  <tr key={p.name}>
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="py-2">
                      <IntegrationBadge status={p.status === "supported" ? "supported" : "disabled"} label={p.status === "supported" ? "Supported" : "Integration unavailable"} />
                    </td>
                    <td className="py-2 text-muted-foreground">{p.sync}</td>
                    <td className="py-2 text-muted-foreground">{p.lead}</td>
                    <td className="py-2 text-muted-foreground">{p.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Stopped by the rules" description="Connections, roles and Copy Groups the compliance engine refused, newest first.">
          <ul className="divide-y">
            {recent.map((row) => (
              <li key={row.id} className="py-2.5 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{String(row.data?.provider ?? "Provider")}</span>
                  <span className="rounded-full border px-2 py-0.5 font-mono">{String(row.data?.reasonCode ?? "")}</span>
                  <span>{String(row.data?.action ?? "")}</span>
                  <span>· {row.email ?? "Deleted user"}</span>
                  <span>· {fmtDateTime(row.createdAt)}</span>
                </p>
                {row.body && <p className="mt-1 text-xs text-muted-foreground">{row.body}</p>}
              </li>
            ))}
            {recent.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">Nothing has been stopped yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
