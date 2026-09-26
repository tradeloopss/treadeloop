// PropFirm Max account detection: given the signals we actually have about an
// account (the Rithmic "system name" its login is provisioned on, the broker
// string, the account size), suggest which firm/program/size it is — with an
// honest confidence, and NEVER as a settled fact. This mirrors the existing
// conservative auto-detect (lib/propfirm-auto-detect.ts): a system name tells
// us the firm, but not which specific challenge structure, so a multi-program
// firm is always flagged for the user to confirm.
import { matchFirmFromSystemName } from "@/lib/propfirm-auto-detect"

// The account sizes firms actually sell, for snapping a starting balance.
export const STANDARD_SIZES = [25_000, 50_000, 100_000, 150_000, 250_000, 300_000]

export interface FirmCandidate {
  firmSlug: string
  firmName: string
  programs: { slug: string; name: string }[]
}

export interface DetectionHints {
  systemName?: string | null // Rithmic system name (e.g. "Apex", "Bulenox Trading")
  broker?: string | null // trading_accounts.broker
  startingBalance?: number | null
}

export type DetectionConfidence = "high" | "medium" | "low" | "unknown"

export interface Detection {
  firmSlug: string | null
  programSlug: string | null
  accountSize: number | null
  confidence: DetectionConfidence
  // Human-readable "why" — always shown, so an auto-match is never a black box.
  reason: string
  // True unless we're certain — the UI must have the user confirm before the
  // rules are treated as authoritative.
  needsConfirmation: boolean
}

// Snap a raw balance to the nearest standard account size, but only when it's
// genuinely close (within 12%). A balance that matches nothing returns null
// rather than a misleading guess.
export function detectAccountSize(startingBalance: number | null | undefined): number | null {
  if (startingBalance == null || !(startingBalance > 0)) return null
  let best: number | null = null
  let bestDelta = Infinity
  for (const size of STANDARD_SIZES) {
    const delta = Math.abs(size - startingBalance)
    if (delta < bestDelta) {
      bestDelta = delta
      best = size
    }
  }
  if (best == null) return null
  return bestDelta <= best * 0.12 ? best : null
}

// Match the firm from the system name / broker string against the catalog.
function detectFirm(hints: DetectionHints, candidates: FirmCandidate[]): FirmCandidate | null {
  const bySlug = new Map(candidates.map((c) => [c.firmSlug, c]))
  // The Rithmic system name is the strongest signal — reuse the existing
  // conservative matcher, then map its firm-name result onto the catalog.
  for (const hint of [hints.systemName, hints.broker]) {
    if (!hint) continue
    const firmName = matchFirmFromSystemName(hint)
    if (firmName) {
      const match = candidates.find((c) => c.firmName === firmName)
      if (match) return match
    }
    // Direct slug-ish contains match against the catalog, as a fallback.
    const h = hint.trim().toLowerCase()
    if (h) {
      const direct = candidates.find((c) => {
        const n = c.firmName.toLowerCase()
        return n.includes(h) || h.includes(n) || c.firmSlug.includes(h.replace(/\s+/g, "-"))
      })
      if (direct) return direct
    }
  }
  void bySlug
  return null
}

// The full suggestion. Deliberately never returns "high" from signals alone —
// the firm's own dashboard is the only place the exact program is known, so a
// human confirm is always the last step (needsConfirmation).
export function detectAccount(hints: DetectionHints, candidates: FirmCandidate[]): Detection {
  const accountSize = detectAccountSize(hints.startingBalance)
  const firm = detectFirm(hints, candidates)

  if (!firm) {
    return {
      firmSlug: null,
      programSlug: null,
      accountSize,
      confidence: "unknown",
      reason: "Couldn't match this account to a known prop firm — pick the firm and program to start tracking.",
      needsConfirmation: true,
    }
  }

  // Firm known. Program: only auto-pick when the firm has exactly one; with
  // several we know the firm but not which challenge — the user decides.
  if (firm.programs.length === 1) {
    return {
      firmSlug: firm.firmSlug,
      programSlug: firm.programs[0].slug,
      accountSize,
      confidence: "medium",
      reason: `Matched ${firm.firmName} from the connection, which has a single program (${firm.programs[0].name}). Confirm the account size and phase.`,
      needsConfirmation: true,
    }
  }

  return {
    firmSlug: firm.firmSlug,
    programSlug: null,
    accountSize,
    confidence: "low",
    reason: `Matched ${firm.firmName}, but it runs ${firm.programs.length} programs — pick which one this account is on so the rules are right.`,
    needsConfirmation: true,
  }
}
