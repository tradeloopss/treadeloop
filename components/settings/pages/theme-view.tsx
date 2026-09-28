"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Palette, Check } from "lucide-react"
import { updateThemeSettings } from "@/app/actions/settings"
import { THEME_PRESETS, type ThemeSettings, type ThemePreset } from "@/lib/settings/defaults"
import { SettingsHeader, SectionLabel, Panel, SettingsRows, SettingsRow } from "@/components/settings/chrome"
import { FieldRow, SegmentedControl } from "@/components/settings/controls"
import { SaveButton } from "@/components/settings/pages/save-button"
import { persistThemeColors } from "@/components/settings/theme-color-applier"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

const PRESET_LABELS: Record<ThemePreset, string> = {
  default: "Default",
  executive: "Executive",
  growth: "Growth",
  focus: "Focus",
}

export function ThemeView({ initial }: { initial: ThemeSettings }) {
  const t = useT()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [s, setS] = useState(initial)
  useEffect(() => setMounted(true), [])

  function applyPreset(preset: ThemePreset) {
    setS(THEME_PRESETS[preset])
  }
  function setColor(k: "color" | "win" | "loss" | "breakeven", v: string) {
    // Editing a color makes this a custom palette.
    setS((p) => ({ ...p, [k]: v }))
  }

  async function save(value: ThemeSettings) {
    await updateThemeSettings(value)
    persistThemeColors({ color: value.color, win: value.win, loss: value.loss, breakeven: value.breakeven })
  }

  const colorFields: { key: "color" | "win" | "loss" | "breakeven"; label: string }[] = [
    { key: "color", label: t("Theme") },
    { key: "win", label: t("Win") },
    { key: "loss", label: t("Loss") },
    { key: "breakeven", label: t("Breakeven") },
  ]

  return (
    <div className="space-y-6">
      <SettingsHeader icon={Palette} title={t("Theme")} />

      <div className="space-y-3">
        <SectionLabel>{t("Mode")}</SectionLabel>
        <Panel title={t("Appearance")}>
          <FieldRow label={t("Color mode")} description={t("Follow your system, or force light or dark.")}>
            {mounted && (
              <SegmentedControl
                value={(theme as "light" | "dark" | "system") ?? "system"}
                onChange={(v) => setTheme(v)}
                options={[
                  { value: "dark", label: t("Dark") },
                  { value: "light", label: t("Light") },
                  { value: "system", label: t("System") },
                ]}
              />
            )}
          </FieldRow>
        </Panel>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("Presets")}</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((preset) => {
            const p = THEME_PRESETS[preset]
            const active = s.preset === preset && !isCustom(s)
            return (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border bg-card p-3 text-start transition-colors hover:bg-accent/40",
                  active && "ring-1 ring-primary",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t(PRESET_LABELS[preset])}</span>
                  {active && <Check className="size-3.5 text-primary" />}
                </div>
                <div className="flex gap-1">
                  {[p.color, p.win, p.loss, p.breakeven].map((c, i) => (
                    <span key={i} className="h-4 flex-1 rounded" style={{ background: c }} />
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("Colors")}</SectionLabel>
        <Panel title={t("Custom Colors")}>
          {colorFields.map((f) => (
            <FieldRow key={f.key} label={f.label}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{s[f.key]}</span>
                <input
                  type="color"
                  aria-label={f.label}
                  value={s[f.key]}
                  onChange={(e) => setColor(f.key, e.target.value)}
                  className="size-7 cursor-pointer rounded border bg-transparent p-0.5"
                />
              </div>
            </FieldRow>
          ))}
        </Panel>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("My Presets")}</SectionLabel>
        <SettingsRows>
          <SettingsRow icon={Palette} title={t("Current palette")} value={isCustom(s) ? t("Custom") : t(PRESET_LABELS[s.preset])}>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t("Save applies these colors across TradeLoop and remembers them on this account.")}</p>
              <div className="flex gap-1.5">
                {[s.color, s.win, s.loss, s.breakeven].map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                    <span className="inline-block size-3 rounded" style={{ background: c }} />
                    <span className="font-mono text-muted-foreground">{c}</span>
                  </span>
                ))}
              </div>
            </div>
          </SettingsRow>
        </SettingsRows>
      </div>

      <SaveButton getValue={() => (isCustom(s) ? { ...s, preset: "default" as ThemePreset } : s)} save={save} />
    </div>
  )
}

// A palette is "custom" once its colors diverge from the named preset it's on.
function isCustom(s: ThemeSettings): boolean {
  const p = THEME_PRESETS[s.preset]
  return !p || s.color !== p.color || s.win !== p.win || s.loss !== p.loss || s.breakeven !== p.breakeven
}
