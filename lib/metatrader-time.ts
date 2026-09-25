// MT5 reports every time in the broker's *server* clock, written as if that
// clock were UTC. Most brokers run the server on "New York close = midnight":
// UTC+2 in the northern winter and UTC+3 in summer, switching on the US DST
// dates — New York time + 7 hours, stored as "ny+7". Others keep a fixed offset
// (Exness runs on plain UTC), stored as "fixed:<seconds>". The sync worker
// measures the offset from the broker's live tick clock (worker/mt5), and
// normalization (lib/metatrader-sync.ts) converts deal times back to real UTC.

const nyFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

// New York's offset from UTC at an instant: -4h (EDT) or -5h (EST), in ms.
function newYorkOffsetMs(utcMs: number): number {
  const parts = nyFormat.formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

// The server clock's offset from UTC at (roughly) a given real instant.
export function serverOffsetMs(zone: string | null | undefined, utcMs: number): number {
  if (zone === "ny+7") return newYorkOffsetMs(utcMs) + 7 * 3_600_000
  const fixed = zone ? /^fixed:(-?\d+)$/.exec(zone) : null
  return fixed ? Number(fixed[1]) * 1000 : 0
}

// A server-clock timestamp (ms) → real UTC ms. The offset is looked up at a
// first guess of the real instant so a time near the US DST switch lands on
// the right side of it.
export function serverTimeToUtc(serverMs: number, zone: string | null | undefined): number {
  const guess = serverMs - serverOffsetMs(zone, serverMs)
  return serverMs - serverOffsetMs(zone, guess)
}

// Real UTC ms → the server clock (for asking the terminal for a time range).
export function utcToServerTime(utcMs: number, zone: string | null | undefined): number {
  return utcMs + serverOffsetMs(zone, utcMs)
}

// Names a measured offset (seconds): "ny+7" when it's what New York + 7h gives
// right now, otherwise a fixed offset. A fixed UTC+2 broker reads as "ny+7" in
// the winter; that corrects itself when summer's measurement disagrees.
export function zoneFromMeasuredOffset(offsetSeconds: number, nowUtcMs: number): string {
  const nyPlus7 = (newYorkOffsetMs(nowUtcMs) + 7 * 3_600_000) / 1000
  return offsetSeconds === nyPlus7 ? "ny+7" : `fixed:${offsetSeconds}`
}
