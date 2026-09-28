"use client"

import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { updatePreferenceSettings } from "@/app/actions/settings"
import type { PreferenceSettings } from "@/lib/settings/defaults"
import { SettingsHeader, SectionLabel, Panel } from "@/components/settings/chrome"
import { FieldRow, SelectField, SegmentedControl } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { useT } from "@/components/locale-provider"

const TIME_ZONES = [
  "Africa/Cairo",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
]

export function PreferencesView({ initial, accounts }: { initial: PreferenceSettings; accounts: { id: string; name: string }[] }) {
  const t = useT()
  const [s, setS] = useState(initial)
  const set = <K extends keyof PreferenceSettings>(k: K, v: PreferenceSettings[K]) => setS((p) => ({ ...p, [k]: v }))

  return (
    <div className="space-y-6">
      <SettingsHeader icon={SlidersHorizontal} title={t("Preferences")} />

      <div className="space-y-3">
        <SectionLabel>{t("Regional")}</SectionLabel>
        <Panel title={t("Dates & Numbers")}>
          <FieldRow label={t("Time zone")} description={t("Used to bucket trades into days. Leave on default to follow your location.")}>
            <SelectField
              value={s.timeZone}
              onChange={(v) => set("timeZone", v)}
              options={[{ value: "", label: t("Automatic (your location)") }, ...TIME_ZONES.map((z) => ({ value: z, label: z }))]}
            />
          </FieldRow>
          <FieldRow label={t("Date format")}>
            <SelectField
              value={s.dateFormat}
              onChange={(v) => set("dateFormat", v)}
              options={[
                { value: "auto", label: t("Automatic") },
                { value: "ymd", label: "YYYY-MM-DD" },
                { value: "mdy", label: "MM/DD/YYYY" },
                { value: "dmy", label: "DD/MM/YYYY" },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("Number format")}>
            <SelectField
              value={s.numberFormat}
              onChange={(v) => set("numberFormat", v)}
              options={[
                { value: "auto", label: t("Automatic") },
                { value: "us", label: "1,234.56" },
                { value: "eu", label: "1.234,56" },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("Week starts on")}>
            <SegmentedControl
              value={s.weekStart}
              onChange={(v) => set("weekStart", v)}
              options={[
                { value: "sunday", label: t("Sunday") },
                { value: "monday", label: t("Monday") },
              ]}
            />
          </FieldRow>
        </Panel>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("Defaults")}</SectionLabel>
        <Panel title={t("Trading")}>
          <FieldRow label={t("Default account")} description={t("Preselected when you add a trade or open the dashboard.")}>
            <SelectField
              value={s.defaultAccountId ?? ""}
              onChange={(v) => set("defaultAccountId", v === "" ? null : v)}
              options={[{ value: "", label: t("None") }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </FieldRow>
        </Panel>
      </div>

      <SaveButton getValue={() => s} save={updatePreferenceSettings} />
    </div>
  )
}
