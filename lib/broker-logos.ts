// Maps a broker / prop-firm / platform label to a bundled logo in
// public/brokers/sm/. Only names we actually ship a logo for return a path;
// everything else returns null and the UI falls back to the initial-avatar
// chip. Matched case-insensitively against the account's broker label (set
// from the matched prop firm on Rithmic connect — see app/actions/rithmic.ts —
// or the broker's company name on MetaTrader). `dark` is an optional variant
// for dark mode (e.g. TradingView's and FTMO's black marks would vanish on a
// dark card).
const LOGOS: { match: string[]; file: string; dark?: string }[] = [
  { match: ["topstep"], file: "topstep.png" },
  { match: ["tradeify"], file: "tradeify.png" },
  { match: ["ftmo"], file: "FTMO.png", dark: "FTMO-dark.png" },
  { match: ["alpha capital"], file: "alphacapital.png" },
  { match: ["lucid"], file: "lucid.png" },
  { match: ["rithmic"], file: "rithmic.png" },
  { match: ["exness"], file: "exness.png" },
  { match: ["tradovate"], file: "tradovate.png" },
  { match: ["ninjatrader"], file: "ninjatrader.png" },
  { match: ["tradingview"], file: "tradingview.png", dark: "tradingview-dark.png" },
  { match: ["metatrader"], file: "metatrader.png" },
]

function find(name: string | null | undefined) {
  if (!name) return null
  const n = name.toLowerCase()
  return LOGOS.find((l) => l.match.some((m) => n.includes(m))) ?? null
}

export function brokerLogo(name: string | null | undefined): string | null {
  const l = find(name)
  return l ? `/brokers/sm/${l.file}` : null
}

// The dark-mode variant, when the logo has one (null otherwise — use brokerLogo).
export function brokerLogoDark(name: string | null | undefined): string | null {
  const l = find(name)
  return l?.dark ? `/brokers/sm/${l.dark}` : null
}
