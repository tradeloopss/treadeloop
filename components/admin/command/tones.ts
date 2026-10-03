// Accent tones for the command center, all from the app's theme tokens (so
// light and dark mode each get their own tuned colour). A tone is never the
// only signal: every use pairs it with an icon, a word or a number.

export type Tone = "danger" | "warning" | "info" | "primary" | "success" | "muted"

export const TONE_ICON: Record<Tone, string> = {
  danger: "bg-loss/12 text-loss dark:bg-loss/18",
  warning: "bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_25%)] dark:bg-warning/18 dark:text-warning",
  info: "bg-chart-5/12 text-chart-5 dark:bg-chart-5/18",
  primary: "bg-primary/10 text-primary dark:bg-primary/18",
  success: "bg-gain/12 text-gain dark:bg-gain/18",
  muted: "bg-muted text-muted-foreground",
}

export const TONE_DOT: Record<Tone, string> = {
  danger: "bg-loss",
  warning: "bg-warning",
  info: "bg-chart-5",
  primary: "bg-primary",
  success: "bg-gain",
  muted: "bg-muted-foreground/60",
}

// "08:42" today, "Yesterday", or "Oct 2".
export function timeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
