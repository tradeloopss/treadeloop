// Maps a broker / prop-firm label to a bundled logo in public/brokers/sm/.
// Only firms we actually ship a logo for return a path; everything else returns
// null and the UI falls back to the initial-avatar chip. Matched case-
// insensitively against the account's broker label (set from the matched prop
// firm on Rithmic connect — see app/actions/rithmic.ts).
const LOGOS: { match: string[]; file: string }[] = [
  { match: ["topstep"], file: "topstep.png" },
  { match: ["tradeify"], file: "tradeify.png" },
  { match: ["ftmo"], file: "FTMO.png" },
  { match: ["alpha capital"], file: "alphacapital.png" },
  { match: ["lucid"], file: "lucid.png" },
  { match: ["rithmic"], file: "rithmic.png" },
]

export function brokerLogo(name: string | null | undefined): string | null {
  if (!name) return null
  const n = name.toLowerCase()
  for (const l of LOGOS) if (l.match.some((m) => n.includes(m))) return `/brokers/sm/${l.file}`
  return null
}
