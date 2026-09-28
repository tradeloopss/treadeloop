import type React from "react"
import { SettingsNav } from "@/components/settings/settings-nav"

// The Settings section's own two-column shell (nav + content), rendered inside
// the app's main scroll area next to the primary sidebar. Each page brings its
// own compact header panel, so there's no global PageHeader here.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:gap-8">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
