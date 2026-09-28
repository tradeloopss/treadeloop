// The site's base timezone is Cairo. Anyone in Egypt — and anyone whose
// location we can't determine — sees Cairo time; everyone else sees their own
// local time, detected from the request IP (Vercel's edge sets
// `x-vercel-ip-timezone` / `x-vercel-ip-country` on every request). This is the
// one place that decides which calendar day a trade counts toward, so the
// journal/calendar/dashboard all bucket on the viewer's real local day rather
// than UTC (a trade closed at 11pm Cairo belongs to that day, not the next).

export const DEFAULT_TIME_ZONE = "Africa/Cairo"

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// The calendar day (YYYY-MM-DD) a moment falls on in a timezone. en-CA formats
// as ISO (YYYY-MM-DD); falls back to Cairo if the zone is somehow invalid.
export function localDay(input: Date | string | number, timeZone: string = DEFAULT_TIME_ZONE): string {
  const d = input instanceof Date ? input : new Date(input)
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

// The timezone to render a request in: the visitor's own (from their IP) unless
// they're in Egypt or we can't tell, in which case the site's base — Cairo.
// Takes anything with a header getter (Next's ReadonlyHeaders or a Headers).
export function resolveTimeZone(headers: { get(name: string): string | null }): string {
  const country = headers.get("x-vercel-ip-country")?.toUpperCase() ?? null
  const tz = headers.get("x-vercel-ip-timezone")
  if (country === "EG" || !tz || !isValidTimeZone(tz)) return DEFAULT_TIME_ZONE
  return tz
}
