"use client"

import { useState } from "react"
import { Bell } from "lucide-react"
import { updateNotificationSettings } from "@/app/actions/settings"
import type { NotificationSettings } from "@/lib/settings/defaults"
import { SettingsHeader, SectionLabel, Panel } from "@/components/settings/chrome"
import { FieldRow, Toggle } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { useT } from "@/components/locale-provider"

export function NotificationsView({ initial }: { initial: NotificationSettings }) {
  const t = useT()
  const [s, setS] = useState(initial)
  const set = <K extends keyof NotificationSettings>(k: K, v: NotificationSettings[K]) => setS((p) => ({ ...p, [k]: v }))

  return (
    <div className="space-y-6">
      <SettingsHeader icon={Bell} title={t("Notifications")} />

      <div className="space-y-3">
        <SectionLabel>{t("Email")}</SectionLabel>
        <Panel title={t("Email Notifications")}>
          <FieldRow label={t("Trade imports")} description={t("When a connected account imports new trades.")}>
            <Toggle checked={s.emailTradeImports} onChange={(v) => set("emailTradeImports", v)} />
          </FieldRow>
          <FieldRow label={t("Weekly review")} description={t("A summary of your week every Monday.")}>
            <Toggle checked={s.emailWeeklyReview} onChange={(v) => set("emailWeeklyReview", v)} />
          </FieldRow>
          <FieldRow label={t("Security alerts")} description={t("New sign-ins and password or 2FA changes.")}>
            <Toggle checked={s.emailSecurity} onChange={(v) => set("emailSecurity", v)} />
          </FieldRow>
          <FieldRow label={t("Product updates")} description={t("Occasional news about new features.")}>
            <Toggle checked={s.emailProduct} onChange={(v) => set("emailProduct", v)} />
          </FieldRow>
        </Panel>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("In-App")}</SectionLabel>
        <Panel title={t("In-App Notifications")}>
          <FieldRow label={t("Enable in-app notifications")} description={t("Toasts and badges inside TradeLoop.")}>
            <Toggle checked={s.inAppEnabled} onChange={(v) => set("inAppEnabled", v)} />
          </FieldRow>
        </Panel>
      </div>

      <SaveButton getValue={() => s} save={updateNotificationSettings} />
    </div>
  )
}
