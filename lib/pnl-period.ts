export type PnlPeriod = "daily" | "weekly"

// A weekly certificate covers the ISO week (Monday–Sunday) containing the
// anchor date, so "this week" means the same seven days for everyone rather
// than a rolling seven days that shifts with the hour it was generated.
export function resolvePnlPeriod(period: PnlPeriod, date: string, dateLocale = "en-US"): { start: string; end: string; label: string } {
  if (period === "daily") {
    return {
      start: date,
      end: date,
      label: new Date(`${date}T12:00:00Z`).toLocaleDateString(dateLocale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
    }
  }

  const anchor = new Date(`${date}T12:00:00Z`)
  const weekday = (anchor.getUTCDay() + 6) % 7 // Monday = 0
  const monday = new Date(anchor)
  monday.setUTCDate(anchor.getUTCDate() - weekday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const fmt = (d: Date) => d.toLocaleDateString(dateLocale, { month: "short", day: "numeric", timeZone: "UTC" })
  return { start: iso(monday), end: iso(sunday), label: `${fmt(monday)} – ${fmt(sunday)}, ${sunday.getUTCFullYear()}` }
}
