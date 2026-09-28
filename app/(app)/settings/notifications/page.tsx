import { getUserSettings } from "@/app/actions/settings"
import { NotificationsView } from "@/components/settings/pages/notifications-view"

export const metadata = { title: "Notifications" }

export default async function NotificationsSettingsPage() {
  const s = await getUserSettings()
  return <NotificationsView initial={s.notifications} />
}
