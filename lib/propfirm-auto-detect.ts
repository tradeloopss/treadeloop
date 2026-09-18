// Best-effort match of a Rithmic system name (the gateway a user's login is
// provisioned on, e.g. "Apex", "Bulenox Trading") against our researched
// preset firm names — powers auto-attaching prop firm rules on connect.
// Deliberately conservative: only returns a match when one side clearly
// contains the other, never a fuzzy/typo-tolerant guess, since an incorrect
// auto-match would misrepresent real evaluation rules.
import { PROP_FIRM_NAMES, getPresetPrograms, type PropFirmPreset } from "@/lib/propfirm-presets"

export function matchFirmFromSystemName(systemName: string): string | null {
  const hint = systemName.trim().toLowerCase()
  if (!hint) return null
  const match = PROP_FIRM_NAMES.find((name) => {
    const n = name.toLowerCase()
    return n.includes(hint) || hint.includes(n)
  })
  return match ?? null
}

// Picks a default program when a matched firm has more than one — we can't
// tell which specific challenge type a Rithmic login is on from the API
// alone (that only lives on the firm's own dashboard), so this is a
// starting guess the user is nudged to verify (see propFirmRules.autoDetected).
export function defaultPresetForFirm(firmName: string): PropFirmPreset | null {
  const programs = getPresetPrograms(firmName)
  return programs[0] ?? null
}
