import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { listPublicShares, listStarterTemplates } from "@/lib/admin/metrics"
import { DisableShareButton, PlaybookEditor, TagGroupEditor } from "@/components/admin/template-editors"
import { AdminPageHeader, EmptyRow, Panel, fmtAgo, fmtNumber } from "@/components/admin/ui"

const KIND_LABELS = { playbook: "Playbook", trade: "Trade", daily: "P&L card", payout: "Payout" }

export default async function AdminTemplatesPage() {
  await requireAdmin({ announcements: ["manage"] })
  const [templates, shares] = await Promise.all([listStarterTemplates(), listPublicShares()])

  return (
    <div>
      <AdminPageHeader
        title="Content"
        description={`What new users start with, and every public link users have shared. ${fmtNumber(templates.seededUsers)} user${templates.seededUsers === 1 ? " has" : "s have"} received the starter set so far.`}
      />
      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Starter tag groups" description="Copied into each new account on its first visit. Editing here doesn't change tags users already have.">
            <TagGroupEditor groups={templates.groups} />
          </Panel>
          <Panel title="Starter playbooks" description="Strategies every new user finds in Playbooks on day one.">
            <PlaybookEditor books={templates.books} />
          </Panel>
        </div>

        <Panel title="Public share links" description="Every live link a user has created: shared playbooks, trades, daily/weekly P&L cards and payout certificates. Disable one to take it down; the owner can re-share.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Shared</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Owner</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {shares.map((s) => (
                  <tr key={`${s.kind}-${s.id}`}>
                    <td className="max-w-[320px] truncate py-2.5 pe-3">
                      <a href={`/p/${s.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                        {s.label} <ExternalLink className="size-3 text-muted-foreground" />
                      </a>
                    </td>
                    <td className="py-2.5 pe-3 text-muted-foreground">{KIND_LABELS[s.kind]}</td>
                    <td className="max-w-[220px] truncate py-2.5 pe-3">
                      <Link href={`/admin/users/${s.userId}`} className="hover:text-primary">{s.email ?? s.userId}</Link>
                    </td>
                    <td className="py-2.5 pe-3 text-muted-foreground">{fmtAgo(s.createdAt)}</td>
                    <td className="py-2.5 text-end"><DisableShareButton kind={s.kind} id={s.id} /></td>
                  </tr>
                ))}
                {shares.length === 0 && <EmptyRow colSpan={5}>Nothing is publicly shared right now.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
