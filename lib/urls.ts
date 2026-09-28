// Absolute base for the app when it lives on its own subdomain (e.g.
// https://app.tradeloop.pro). Unset → empty string, so links stay same-origin
// and everything works on a single domain (current setup, previews, localhost).
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ""

// A link into the app. Same-origin (relative) unless NEXT_PUBLIC_APP_URL is set.
export const appHref = (path: string) => `${APP_URL}${path}`

// The Help Center base. Defaults to /help on the current origin; set
// NEXT_PUBLIC_HELP_URL to https://help.tradeloop.pro once the subdomain is live.
export const HELP_URL = process.env.NEXT_PUBLIC_HELP_URL ?? "/help"

