import type { Metadata } from "next"
import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { getAdminPrefs } from "@/lib/admin/preferences"
import { capabilities, notifications } from "@/lib/admin/command-center"
import { AdminPageHeader, fmtDateTime } from "@/components/admin/ui"
import { MarkAllRead, NotificationRow } from "@/components/admin/settings/notification-list"

export const metadata: Metadata = { title: "Notifications — TradeLoop Admin" }

// Everything the bell shows, in full.
export default async function AdminNotificationsPage() {
  const admin = await requireAdmin()
  const prefs = await getAdminPrefs(admin.id)
  let data: Awaited<ReturnType<typeof notifications>> | null = null
  try {
    data = await notifications(capabilities(admin.role), prefs)
  } catch (e) {
    console.error("[admin] notifications page failed:", e instanceof Error ? e.message : e)
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <AdminPageHeader
        title="Notifications"
        description="What's waiting on the team right now, for the areas your role can open."
        action={data && data.unread > 0 ? <MarkAllRead /> : undefined}
      />
      <div className="p-4 sm:p-6">
        {!data ? (
          <p className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">Unable to load notifications. Reload the page to try again.</p>
        ) : data.items.length === 0 ? (
          <p className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up. Nothing needs your attention.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {data.items.map((item) => (
              <li key={item.key}>
                <NotificationRow item={item} when={fmtDateTime(item.at)} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Choose which kinds of alert you get in{" "}
          <Link href="/admin/settings?section=notifications" className="font-medium text-primary hover:underline">
            Admin settings
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
