import { HELP_URL } from "@/lib/urls"

// Prop firms that do not allow a trading account to be reached from a server.
//
// TradeLoop reads a MetaTrader account from its own sync server (worker/mt5).
// To the firm that is the account being opened from a data centre in another
// country: the access its rules forbid, read-only password or not, and the
// trader is the one who loses the account for it. So an account at one of
// these firms is never connected. connectMetaTrader refuses it (that is the
// rule), and the connect form says so as the server name is typed, before any
// password is.
//
// FundingPips: "Connecting to a VPN or VPS while accessing your trading
// account is not permitted" (Trading Conduct and Security Standards, read
// 2026-10-07). It has a copier of its own that can feed an account outside
// FundingPips, which TradeLoop then copies from: that is what the guide says.
//
// Never add a broker pack for one of these to the sync server.
const FIRMS: { firm: string; names: string[]; guide: string }[] = [{ firm: "FundingPips", names: ["fundingpips"], guide: "/connecting-accounts/fundingpips" }]

export type ServerAccessBlock = {
  firm: string
  message: string
  // what the trader can do instead
  guide: { label: string; href: string }
}

export function serverAccessBlock(server: string): ServerAccessBlock | null {
  // "FundingPips2-SIM", "Funding Pips - Live": the firm's name however it is spaced
  const name = server.toLowerCase().replace(/[^a-z0-9]/g, "")
  const hit = FIRMS.find((f) => f.names.some((n) => name.includes(n)))
  if (!hit) return null
  return {
    firm: hit.firm,
    message: `${hit.firm} accounts can't be connected to TradeLoop. ${hit.firm} doesn't allow a trading account to be opened from a server, and TradeLoop syncs from one, so connecting it could cost you the account.`,
    guide: { label: `How to use TradeLoop with a ${hit.firm} account`, href: `${HELP_URL}${hit.guide}` },
  }
}
