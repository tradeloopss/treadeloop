"use client"

import { useState } from "react"
import { Calculator } from "lucide-react"
import { updateCalculationSettings } from "@/app/actions/settings"
import type { CalculationSettings } from "@/lib/settings/defaults"
import { SettingsHeader, SectionLabel, Panel } from "@/components/settings/chrome"
import { FieldRow, SegmentedControl, Toggle } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { Input } from "@/components/ui/input"
import { useT } from "@/components/locale-provider"

export function CalculationsView({ initial }: { initial: CalculationSettings }) {
  const t = useT()
  const [s, setS] = useState(initial)
  const set = <K extends keyof CalculationSettings>(k: K, v: CalculationSettings[K]) => setS((p) => ({ ...p, [k]: v }))

  return (
    <div className="space-y-6">
      <SettingsHeader icon={Calculator} title={t("Calculations")} />

      <div className="space-y-3">
        <SectionLabel>{t("Risk")}</SectionLabel>
        <Panel title={t("Risk & R-Multiple")}>
          <FieldRow label={t("Default risk per trade")} description={t("Percent of account risked, used to size trades and suggest stops.")}>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={s.defaultRiskPercent}
                onChange={(e) => set("defaultRiskPercent", Number(e.target.value))}
                className="w-20 text-right"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </FieldRow>
          <FieldRow label={t("R-multiple basis")} description={t("What one R equals when reporting reward.")}>
            <SegmentedControl
              value={s.rMultipleBasis}
              onChange={(v) => set("rMultipleBasis", v)}
              options={[
                { value: "risk", label: t("Planned risk") },
                { value: "initialStop", label: t("Initial stop") },
              ]}
            />
          </FieldRow>
        </Panel>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("Account & P&L")}</SectionLabel>
        <Panel title={t("Account Size & P&L")}>
          <FieldRow label={t("Account size basis")} description={t("Which figure risk percentages are measured against.")}>
            <SegmentedControl
              value={s.accountSizeBasis}
              onChange={(v) => set("accountSizeBasis", v)}
              options={[
                { value: "balance", label: t("Balance") },
                { value: "equity", label: t("Equity") },
                { value: "custom", label: t("Custom") },
              ]}
            />
          </FieldRow>
          {s.accountSizeBasis === "custom" && (
            <FieldRow label={t("Custom account size")}>
              <Input
                type="number"
                min={0}
                value={s.customAccountSize ?? ""}
                onChange={(e) => set("customAccountSize", e.target.value === "" ? null : Number(e.target.value))}
                className="w-32 text-right"
              />
            </FieldRow>
          )}
          <FieldRow label={t("Include commissions in P&L")} description={t("Subtract fees so every figure is net.")}>
            <Toggle checked={s.commissionInPnl} onChange={(v) => set("commissionInPnl", v)} />
          </FieldRow>
        </Panel>
      </div>

      <SaveButton getValue={() => s} save={updateCalculationSettings} />
    </div>
  )
}
