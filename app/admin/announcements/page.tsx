import { requireAdmin } from "@/lib/admin/guard"
import { listAnnouncements } from "@/lib/admin/metrics"
import { AnnouncementForm } from "@/components/admin/forms"
import { AnnouncementToggle } from "@/components/admin/row-actions"
import { AdminPageHeader, Panel, StatePill, fmtDateTime } from "@/components/admin/ui"

export default async function AdminAnnouncementsPage() {
  await requireAdmin({ announcements: ["manage"] })
  const rows = await listAnnouncements()
  const now = Date.now()

  return (
    <div>
      <AdminPageHeader title="Announcements" description="A banner at the top of every signed-in page — for maintenance windows, outages and launches." />
      <div className="space-y-6 p-4 sm:p-6">
        <Panel title="New announcement">
          <AnnouncementForm />
        </Panel>
        <Panel title="Published">
          <ul className="divide-y">
            {rows.map((a) => {
              const expired = a.endsAt && new Date(a.endsAt).getTime() < now
              const live = a.active && !expired
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{a.message}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.level === "warning" ? "Warning" : "Info"} · by {a.createdBy} · {fmtDateTime(a.createdAt)}
                      {a.endsAt ? ` · ${expired ? "ended" : "ends"} ${fmtDateTime(a.endsAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatePill state={live ? "active" : "inactive"}>{live ? "Live" : expired ? "Ended" : "Off"}</StatePill>
                    {!expired && <AnnouncementToggle id={a.id} active={a.active} />}
                  </div>
                </li>
              )
            })}
            {rows.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">Nothing published yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
