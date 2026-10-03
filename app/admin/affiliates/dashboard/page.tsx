import Link from "next/link"
import { inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { affiliates } from "@/lib/db/schema"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { FEEDBACK_RATINGS } from "@/lib/affiliates/v2/config"
import { feedbackForAdmin, getV2Config } from "@/lib/affiliates/v2/server"
import { AdminPageHeader, Panel, fmtDateTime } from "@/components/admin/ui"
import { DashboardV2Form } from "@/components/admin/affiliates/dashboard-v2-form"

// The Affiliate Dashboard V2 beta: rollout controls and what affiliates said about it.
export default async function AdminAffiliateDashboardPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const [config, feedback] = await Promise.all([getV2Config(), feedbackForAdmin(100)])
  const named = config.selected.length ? await db.select({ id: affiliates.id, firstName: affiliates.firstName, lastName: affiliates.lastName }).from(affiliates).where(inArray(affiliates.id, config.selected)) : []
  const total = Object.values(feedback.tally).reduce((a, b) => a + b, 0)

  return (
    <div>
      <AdminPageHeader title="Affiliate Dashboard V2" description="The redesigned affiliate dashboard, in beta: who gets it, which features it has, and the feedback it collects." />
      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-5">
        <Panel title="Rollout" description={`${feedback.v2Users} affiliate${feedback.v2Users === 1 ? " has" : "s have"} chosen V2.`} className="xl:col-span-3">
          <DashboardV2Form initial={config} canManage={canManage} />
          {named.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              Selected:{" "}
              {named.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link href={`/admin/affiliates/${a.id}`} className="text-primary hover:underline">
                    #{a.id} {a.firstName} {a.lastName}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </Panel>
        <Panel title="Beta feedback" description={total ? `${total} response${total === 1 ? "" : "s"}` : "Nothing yet"} className="xl:col-span-2">
          <ul className="mb-4 grid grid-cols-2 gap-2">
            {FEEDBACK_RATINGS.map((r) => (
              <li key={r.key} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span aria-hidden>{r.emoji}</span>
                <span className="flex-1">{r.label}</span>
                <span className="font-semibold tabular-nums">{feedback.tally[r.key] ?? 0}</span>
              </li>
            ))}
          </ul>
          <ul className="max-h-[560px] divide-y overflow-y-auto">
            {feedback.rows.map((f) => {
              const r = FEEDBACK_RATINGS.find((x) => x.key === f.rating)
              return (
                <li key={f.id} className="py-3">
                  <p className="flex items-center gap-2 text-sm">
                    <span aria-hidden>{r?.emoji}</span>
                    <span className="font-medium">{r?.label ?? f.rating}</span>
                    <span className="ms-auto text-xs text-muted-foreground">{fmtDateTime(f.createdAt)}</span>
                  </p>
                  {f.message && <p className="mt-1 text-sm whitespace-pre-wrap">{f.message}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    <Link href={`/admin/affiliates/${f.affiliateId}`} className="hover:underline">
                      {f.firstName} {f.lastName}
                    </Link>
                    {f.page ? ` · ${f.page}` : ""}
                  </p>
                </li>
              )
            })}
            {feedback.rows.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No feedback yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
