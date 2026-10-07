import { HELP_URL, siteHref } from "@/lib/urls"

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
// 2026-10-07). Its support, asked that day, in writing: "using a VPS or VPN
// for the setup is not permitted, and using the investor password does not
// override this restriction"; and "copying trades onward from an external
// follower account into a FundingPips account using another tool is not
// permitted". So a FundingPips account is neither read nor written from here,
// and is never in a copy group. It has a copier of its own, which copies
// between a trader's own FundingPips accounts and can feed an account outside
// FundingPips; TradeLoop copies from that one. That is what the guide says.
// Its MT5 servers, from its own help pages: FundingPips-Trial, -Prime, -SIM,
// -SIM1 and FundingPips2-SIM.
//
// Never add a broker pack for one of these to the sync server.
const FIRMS: { firm: string; names: string[]; guide: string }[] = [{ firm: "FundingPips", names: ["fundingpips"], guide: "/connecting-accounts/fundingpips" }]

// The Help Center is on the public site: on the app's own address /help goes to
// the dashboard (proxy.ts).
const helpHref = (path: string) => `${HELP_URL.startsWith("http") ? HELP_URL : siteHref(HELP_URL)}${path}`

export type ServerAccessBlock = {
  firm: string
  message: string
  // what the trader can do instead
  guide: { label: string; href: string }
}

// The same rule in Copy Trading: such an account is neither copied from nor to.
export const copyBlockMessage = (block: ServerAccessBlock) => `${block.firm} accounts can't be in a copy group. ${block.firm} doesn't allow TradeLoop to reach them, and nothing may be copied into one.`

// Where Copy Trading sends a FundingPips trader.
export const FUNDINGPIPS_GUIDE = helpHref("/connecting-accounts/fundingpips")

export function serverAccessBlock(server: string): ServerAccessBlock | null {
  // "FundingPips2-SIM", "Funding Pips - Live": the firm's name however it is spaced
  const name = server.toLowerCase().replace(/[^a-z0-9]/g, "")
  const hit = FIRMS.find((f) => f.names.some((n) => name.includes(n)))
  if (!hit) return null
  return {
    firm: hit.firm,
    message: `${hit.firm} accounts can't be connected to TradeLoop. ${hit.firm} doesn't allow a trading account to be opened from a server, even with the read-only password, and TradeLoop syncs from one. Connecting it could cost you the account.`,
    guide: { label: `How to use TradeLoop with a ${hit.firm} account`, href: helpHref(hit.guide) },
  }
}
