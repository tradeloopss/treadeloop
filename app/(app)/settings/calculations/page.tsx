import { getUserSettings } from "@/app/actions/settings"
import { CalculationsView } from "@/components/settings/pages/calculations-view"

export const metadata = { title: "Calculations" }

export default async function CalculationsSettingsPage() {
  const s = await getUserSettings()
  return <CalculationsView initial={s.calculations} />
}
