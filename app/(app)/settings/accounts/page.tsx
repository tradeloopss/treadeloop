import { AccountsSection } from "@/components/accounts/accounts-section"
import { AccountsSettingsShell } from "@/components/settings/pages/accounts-view"

export const metadata = { title: "Accounts" }

// Same 1-minute budget as /accounts (connecting/syncing run here).
export const maxDuration = 60

export default function AccountsSettingsPage() {
  return (
    <AccountsSettingsShell>
      <AccountsSection label="/settings/accounts" />
    </AccountsSettingsShell>
  )
}
