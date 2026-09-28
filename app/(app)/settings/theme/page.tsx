import { getUserSettings } from "@/app/actions/settings"
import { ThemeView } from "@/components/settings/pages/theme-view"

export const metadata = { title: "Theme" }

export default async function ThemeSettingsPage() {
  const s = await getUserSettings()
  return <ThemeView initial={s.theme} />
}
