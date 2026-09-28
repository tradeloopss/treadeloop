import { redirect } from "next/navigation"

// Settings opens on Security (the account's most-used controls), matching the
// reference. Individual sections live at /settings/<name>.
export default function SettingsIndex() {
  redirect("/settings/security")
}
