"use client"

import { useState } from "react"
import { Lock, Download } from "lucide-react"
import { toast } from "sonner"
import { updatePrivacySettings, exportUserData } from "@/app/actions/settings"
import type { PrivacySettings } from "@/lib/settings/defaults"
import { SettingsHeader, SectionLabel, Panel } from "@/components/settings/chrome"
import { FieldRow, SelectField, Toggle } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { Button } from "@/components/ui/button"
import { useT } from "@/components/locale-provider"

const RETENTION_OPTS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
  { value: "0", label: "Forever" },
]

export function PrivacyView({ initial }: { initial: PrivacySettings }) {
  const t = useT()
  const [s, setS] = useState(initial)
  const [exporting, setExporting] = useState(false)
  const set = <K extends keyof PrivacySettings>(k: K, v: PrivacySettings[K]) => setS((p) => ({ ...p, [k]: v }))
  const setRetention = (k: keyof PrivacySettings["retention"], v: number) =>
    setS((p) => ({ ...p, retention: { ...p.retention, [k]: v } }))

  async function onExport() {
    setExporting(true)
    try {
      const json = await exportUserData()
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `tradeloop-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t("Your data is downloading."))
    } catch {
      toast.error(t("Could not export your data"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsHeader icon={Lock} title={t("Privacy")} />

      <div className="space-y-3">
        <SectionLabel>{t("Visibility & Sharing")}</SectionLabel>
        <Panel title={t("Visibility & Sharing")}>
          <FieldRow label={t("Profile visibility")} description={t("Who can see your public profile.")}>
            <SelectField
              value={s.profileVisibility}
              onChange={(v) => set("profileVisibility", v)}
              options={[
                { value: "public", label: t("Public") },
                { value: "unlisted", label: t("Unlisted") },
                { value: "private", label: t("Private") },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("Activity visibility")} description={t("Who can see your trading activity and stats.")}>
            <SelectField
              value={s.activityVisibility}
              onChange={(v) => set("activityVisibility", v)}
              options={[
                { value: "public", label: t("Public") },
                { value: "followers", label: t("Followers") },
                { value: "private", label: t("Private") },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("Data sharing")} description={t("Share anonymized usage to help improve TradeLoop.")}>
            <Toggle checked={s.dataSharing} onChange={(v) => set("dataSharing", v)} />
          </FieldRow>
          <FieldRow label={t("Export data")} description={t("Download your trades, journal and settings as JSON.")}>
            <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
              <Download className="size-3.5" />
              {exporting ? t("Preparing…") : t("Export")}
            </Button>
          </FieldRow>
        </Panel>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("Cookies & Retention")}</SectionLabel>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={t("Cookie Preferences")}>
            <FieldRow label={t("Essential")} description={t("Required to sign in and keep the app working.")}>
              <Toggle checked onChange={() => toast(t("Essential cookies can't be turned off."))} label={t("Essential")} />
            </FieldRow>
            <FieldRow label={t("Analytics")} description={t("Anonymous usage to understand what to improve.")}>
              <Toggle checked={s.cookieAnalytics} onChange={(v) => set("cookieAnalytics", v)} />
            </FieldRow>
            <FieldRow label={t("Marketing")} description={t("Measure campaigns and show relevant offers.")}>
              <Toggle checked={s.cookieMarketing} onChange={(v) => set("cookieMarketing", v)} />
            </FieldRow>
          </Panel>

          <Panel title={t("Data Retention")}>
            <FieldRow label={t("Login history")}>
              <SelectField
                value={String(s.retention.loginHistoryDays)}
                onChange={(v) => setRetention("loginHistoryDays", Number(v))}
                options={RETENTION_OPTS}
              />
            </FieldRow>
            <FieldRow label={t("Old sessions")}>
              <SelectField
                value={String(s.retention.oldSessionsDays)}
                onChange={(v) => setRetention("oldSessionsDays", Number(v))}
                options={RETENTION_OPTS}
              />
            </FieldRow>
            <FieldRow label={t("Activity logs")}>
              <SelectField
                value={String(s.retention.activityLogsDays)}
                onChange={(v) => setRetention("activityLogsDays", Number(v))}
                options={RETENTION_OPTS}
              />
            </FieldRow>
          </Panel>
        </div>
      </div>

      <SaveButton getValue={() => s} save={updatePrivacySettings} />
    </div>
  )
}
