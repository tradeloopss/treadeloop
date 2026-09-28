import { getUserSettings } from "@/app/actions/settings"
import { PrivacyView } from "@/components/settings/pages/privacy-view"

export const metadata = { title: "Privacy" }

export default async function PrivacySettingsPage() {
  const s = await getUserSettings()
  return <PrivacyView initial={s.privacy} />
}
