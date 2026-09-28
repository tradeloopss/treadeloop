"use client"

import { useState } from "react"
import { Layers } from "lucide-react"
import { updateOrderGroupingSettings } from "@/app/actions/settings"
import type { OrderGroupingSettings } from "@/lib/settings/defaults"
import { SettingsHeader, SectionLabel, Panel } from "@/components/settings/chrome"
import { FieldRow, SegmentedControl, Toggle } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { useT } from "@/components/locale-provider"

export function OrderGroupingView({ initial }: { initial: OrderGroupingSettings }) {
  const t = useT()
  const [s, setS] = useState(initial)
  const set = <K extends keyof OrderGroupingSettings>(k: K, v: OrderGroupingSettings[K]) => setS((p) => ({ ...p, [k]: v }))

  return (
    <div className="space-y-6">
      <SettingsHeader icon={Layers} title={t("Order Grouping")} />

      <div className="space-y-3">
        <SectionLabel>{t("How fills become trades")}</SectionLabel>
        <Panel title={t("Grouping")}>
          <FieldRow label={t("Group orders by")} description={t("How individual fills are rolled up into a single trade.")}>
            <SegmentedControl
              value={s.groupBy}
              onChange={(v) => set("groupBy", v)}
              options={[
                { value: "none", label: t("None") },
                { value: "symbol", label: t("Symbol") },
                { value: "day", label: t("Day") },
                { value: "session", label: t("Session") },
              ]}
            />
          </FieldRow>
          <FieldRow label={t("Merge scale-ins & scale-outs")} description={t("Treat adds and partials on one position as the same trade.")}>
            <Toggle checked={s.mergeScaleIns} onChange={(v) => set("mergeScaleIns", v)} />
          </FieldRow>
          <FieldRow label={t("P&L reporting")} description={t("Show profit before or after fees across the app.")}>
            <SegmentedControl
              value={s.netVsGross}
              onChange={(v) => set("netVsGross", v)}
              options={[
                { value: "net", label: t("Net") },
                { value: "gross", label: t("Gross") },
              ]}
            />
          </FieldRow>
        </Panel>
      </div>

      <SaveButton getValue={() => s} save={updateOrderGroupingSettings} />
    </div>
  )
}
