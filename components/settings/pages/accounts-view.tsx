"use client"

import type React from "react"
import { Wallet } from "lucide-react"
import { SettingsHeader } from "@/components/settings/chrome"
import { useT } from "@/components/locale-provider"

// Client header shell so the (server) AccountsSection can render underneath a
// settings header without the icon prop crossing the RSC boundary.
export function AccountsSettingsShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="space-y-6">
      <SettingsHeader icon={Wallet} title={t("Accounts")} />
      {children}
    </div>
  )
}
