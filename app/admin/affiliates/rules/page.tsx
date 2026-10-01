import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { rulesList } from "@/lib/affiliates/admin-queries"
import { getProgram } from "@/lib/affiliates/program"
import { AdminPageHeader, Panel } from "@/components/admin/ui"
import { ProgramForm, RulesTable } from "@/components/admin/affiliates/program-form"

const PRIORITY = [
  ["1", "A rule for the affiliate", "e.g. a launch partner on 40%."],
  ["2", "A rule for the campaign", "the campaign the customer came through."],
  ["3", "A rule for the coupon", "the coupon the customer paid with."],
  ["4", "The affiliate's tier", "by paying customers, or a manual tier."],
  ["5", "The program default", "the rate set below."],
] as const

export default async function AdminAffiliateRulesPage() {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const [program, rules] = await Promise.all([getProgram(), rulesList()])

  return (
    <div>
      <AdminPageHeader title="Commission rules" description="What the program pays, and the exceptions to it." />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <Panel title="Program rules" description="The defaults every affiliate starts from.">
          <ProgramForm program={program} canManage={canManage} />
        </Panel>

        <Panel title="Which rate wins" description="For each payment the first of these that applies is used. Within a level, the newest rule wins.">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {PRIORITY.map(([n, title, body]) => (
              <li key={n} className="rounded-lg border px-3 py-2.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums text-muted-foreground">{n}</span>
                  {title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Custom rules</h2>
            <p className="text-xs text-muted-foreground">Rules are added from an affiliate&apos;s own page, where their campaigns and coupons can be picked.</p>
          </div>
          <RulesTable
            canManage={canManage}
            rules={rules.map((r) => ({
              id: r.id,
              scope: r.scope,
              affiliateId: r.affiliateId,
              affiliate: `${r.firstName} ${r.lastName}`.trim(),
              target: r.scope === "campaign" ? r.campaign : r.scope === "coupon" ? r.coupon : null,
              ratePercent: r.ratePercent,
              durationMonths: r.durationMonths,
              startsAt: r.startsAt ? r.startsAt.toISOString() : null,
              endsAt: r.endsAt ? r.endsAt.toISOString() : null,
              enabled: r.enabled,
              note: r.note,
            }))}
          />
        </section>
      </div>
    </div>
  )
}
