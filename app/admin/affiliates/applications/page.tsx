import Link from "next/link"
import { desc, eq, inArray } from "drizzle-orm"
import { Inbox } from "lucide-react"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { countryName } from "@/lib/affiliates/countries"
import { getProgram } from "@/lib/affiliates/program"
import { SOCIAL_KEYS, SOCIAL_LABELS } from "@/lib/affiliates/types"
import { AdminPageHeader, fmtAgo } from "@/components/admin/ui"
import { Empty, StatusBadge } from "@/components/affiliate/ui"
import { ApplicationActions } from "@/components/admin/affiliates/actions"

const TABS: [string, string][] = [["waiting", "Waiting"], ["rejected", "Rejected"]]

// Only http(s) links from an application are rendered as links.
const safeUrl = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null)

export default async function AdminAffiliateApplicationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const view = (await searchParams).view === "rejected" ? "rejected" : "waiting"
  const [rows, program] = await Promise.all([
    db
      .select()
      .from(affiliates)
      .where(view === "rejected" ? eq(affiliates.status, "rejected") : inArray(affiliates.status, ["pending", "review"]))
      .orderBy(desc(affiliates.createdAt))
      .limit(100),
    getProgram(),
  ])

  return (
    <div>
      <AdminPageHeader title="Applications" description={program.autoApprove ? "Auto-approve is ON: new applicants are accepted immediately (change it under Commission rules)." : "People who applied to the program. Approve the ones whose audience fits."} />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="inline-flex w-fit rounded-lg bg-muted p-[3px]" role="group" aria-label="View">
          {TABS.map(([v, label]) => (
            <Link key={v} href={`?view=${v}`} aria-current={v === view ? "true" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-medium ${v === view ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <Empty icon={Inbox} title={view === "waiting" ? "No applications waiting" : "No rejected applications"}>
              {view === "waiting" ? "New applications from /affiliate/apply land here." : undefined}
            </Empty>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((a) => {
              const website = safeUrl(a.website)
              const socials = SOCIAL_KEYS.filter((k) => a.socials?.[k])
              return (
                <li key={a.id} className="rounded-xl border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/affiliates/${a.id}`} className="text-sm font-semibold hover:underline">
                          {a.firstName} {a.lastName}
                        </Link>
                        <StatusBadge status={a.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.email} · {countryName(a.country)} · applied {fmtAgo(a.createdAt)}
                      </p>
                    </div>
                    {canManage && <ApplicationActions id={a.id} status={a.status} name={`${a.firstName} ${a.lastName}`} />}
                  </div>
                  <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Traffic source</dt>
                      <dd>{a.trafficSource ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Audience size</dt>
                      <dd>{a.audienceSize ?? "—"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Website</dt>
                      <dd className="truncate">
                        {website ? (
                          <a href={website} target="_blank" rel="noreferrer nofollow" className="text-primary hover:underline">
                            {website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Social profiles</dt>
                      <dd className="truncate">{socials.length ? socials.map((k) => `${SOCIAL_LABELS[k]}: ${a.socials![k]}`).join(" · ") : "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">How they&apos;ll promote</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{a.promotionMethod || "—"}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Why they want to partner</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{a.reason || "—"}</p>
                    </div>
                  </div>
                  {a.status === "rejected" && a.rejectionReason && <p className="mt-3 text-sm text-[var(--loss)]">Rejected: {a.rejectionReason}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
