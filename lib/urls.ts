// Absolute base for the app when it lives on its own subdomain (e.g.
// https://app.tradeloop.pro). Unset → empty string, so links stay same-origin
// and everything works on a single domain (current setup, previews, localhost).
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ""

// A link into the app. Same-origin (relative) unless NEXT_PUBLIC_APP_URL is set.
export const appHref = (path: string) => `${APP_URL}${path}`

// The public site's own origin (https://www.tradeloop.pro): NEXT_PUBLIC_SITE_URL,
// else worked out from the app's address when that is on its own subdomain.
// Unset → empty, so links stay same-origin (previews, localhost).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? (/^https?:\/\/app\./.test(APP_URL) ? APP_URL.replace("://app.", "://www.") : "")).replace(/\/+$/, "")

// A link to a page of the public site ("/pricing"), from wherever it is shown —
// the Help Center and the affiliate program live on other addresses.
export const siteHref = (path: string) => `${SITE_URL}${path === "/" && SITE_URL ? "" : path}`

// The affiliate portal's own origin (e.g. https://affiliate.tradeloop.pro),
// where it sits at the root: /payouts rather than /affiliate/payouts. Unset →
// the portal lives under /affiliate on the app's origin (previews, localhost).
export const AFFILIATE_URL = (process.env.NEXT_PUBLIC_AFFILIATE_URL ?? "").replace(/\/+$/, "")

// A link to a portal page, from its in-app path ("/affiliate/payouts"). The
// in-app path is what the code and the database use everywhere; this turns it
// into the address people see.
export function affiliateHref(path: string): string {
  if (!AFFILIATE_URL || !/^\/affiliate(?=\/|\?|#|$)/.test(path)) return path
  const rest = path.slice("/affiliate".length)
  return `${AFFILIATE_URL}${rest.startsWith("/") ? rest : `/${rest}`}`
}

// Any link stored by the program (a notification's target): a portal page, or
// a page of the app itself.
export const portalHref = (path: string) => (/^\/affiliate(?=\/|\?|#|$)/.test(path) ? affiliateHref(path) : appHref(path))

// The Help Center base. Defaults to /help on the current origin; set
// NEXT_PUBLIC_HELP_URL to https://help.tradeloop.pro once the subdomain is live.
export const HELP_URL = process.env.NEXT_PUBLIC_HELP_URL ?? "/help"

