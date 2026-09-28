// Typed shapes + defaults for everything the Settings section stores in the
// user_settings row (lib/db/schema.ts → userSettings). The DB columns are
// nullable jsonb, so a user who has never touched a setting simply gets these
// defaults. resolveSettings() merges a (possibly null/partial) row on top of
// the defaults so callers always work with a fully-populated object.
//
// Theme presets are named palettes; DEFAULT keeps TradeLoop's brand accent
// (the --primary token, a blue-violet). Win/Loss/Breakeven mirror the app's
// --gain/--loss tokens as hex so the picker has a concrete starting value.

export type SocialLinks = {
  x: string
  tradingview: string
  discord: string
  website: string
}

export type PrivacySettings = {
  profileVisibility: "public" | "unlisted" | "private"
  activityVisibility: "public" | "followers" | "private"
  dataSharing: boolean
  cookieAnalytics: boolean
  cookieMarketing: boolean
  retention: {
    loginHistoryDays: number
    oldSessionsDays: number
    activityLogsDays: number
  }
}

export type ThemePreset = "default" | "executive" | "growth" | "focus"

export type ThemeSettings = {
  preset: ThemePreset
  color: string // brand/accent
  win: string
  loss: string
  breakeven: string
}

export type CalculationSettings = {
  defaultRiskPercent: number
  accountSizeBasis: "balance" | "equity" | "custom"
  customAccountSize: number | null
  commissionInPnl: boolean
  rMultipleBasis: "risk" | "initialStop"
}

export type OrderGroupingSettings = {
  groupBy: "none" | "symbol" | "day" | "session"
  netVsGross: "net" | "gross"
  mergeScaleIns: boolean
}

export type NotificationSettings = {
  emailTradeImports: boolean
  emailWeeklyReview: boolean
  emailSecurity: boolean
  emailProduct: boolean
  inAppEnabled: boolean
}

export type PreferenceSettings = {
  timeZone: string // "" = follow the site/IP default (Africa/Cairo → local)
  dateFormat: "auto" | "ymd" | "mdy" | "dmy"
  weekStart: "sunday" | "monday"
  numberFormat: "auto" | "us" | "eu"
  defaultAccountId: string | null
}

export type ResolvedSettings = {
  username: string | null
  bio: string | null
  tradingStrategy: string | null
  yearsTrading: number | null
  social: SocialLinks
  privacy: PrivacySettings
  theme: ThemeSettings
  calculations: CalculationSettings
  orderGrouping: OrderGroupingSettings
  notifications: NotificationSettings
  preferences: PreferenceSettings
}

export const DEFAULT_SOCIAL: SocialLinks = { x: "", tradingview: "", discord: "", website: "" }

export const DEFAULT_PRIVACY: PrivacySettings = {
  profileVisibility: "unlisted",
  activityVisibility: "private",
  dataSharing: false,
  cookieAnalytics: true,
  cookieMarketing: false,
  retention: { loginHistoryDays: 90, oldSessionsDays: 30, activityLogsDays: 180 },
}

// Named palettes for the Theme page. `color` is the accent, and each preset
// carries its own win/loss/breakeven so the preview strips read distinctly.
export const THEME_PRESETS: Record<ThemePreset, ThemeSettings> = {
  default: { preset: "default", color: "#6d4aff", win: "#16a34a", loss: "#dc2626", breakeven: "#3b82f6" },
  executive: { preset: "executive", color: "#3b6cf6", win: "#0ea5a4", loss: "#e11d48", breakeven: "#64748b" },
  growth: { preset: "growth", color: "#16a34a", win: "#22c55e", loss: "#f97316", breakeven: "#84cc16" },
  focus: { preset: "focus", color: "#8b5cf6", win: "#10b981", loss: "#ef4444", breakeven: "#a78bfa" },
}

export const DEFAULT_THEME: ThemeSettings = THEME_PRESETS.default

export const DEFAULT_CALCULATIONS: CalculationSettings = {
  defaultRiskPercent: 1,
  accountSizeBasis: "balance",
  customAccountSize: null,
  commissionInPnl: true,
  rMultipleBasis: "risk",
}

export const DEFAULT_ORDER_GROUPING: OrderGroupingSettings = {
  groupBy: "symbol",
  netVsGross: "net",
  mergeScaleIns: true,
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  emailTradeImports: true,
  emailWeeklyReview: true,
  emailSecurity: true,
  emailProduct: false,
  inAppEnabled: true,
}

export const DEFAULT_PREFERENCES: PreferenceSettings = {
  timeZone: "",
  dateFormat: "auto",
  weekStart: "monday",
  numberFormat: "auto",
  defaultAccountId: null,
}

// Shallow-merge a stored group on top of its defaults. Nested `retention`
// merges one level deeper so a partial stored object keeps the rest.
function merge<T extends object>(base: T, stored: unknown): T {
  if (!stored || typeof stored !== "object") return { ...base }
  return { ...base, ...(stored as Partial<T>) }
}

export type UserSettingsRow = {
  username: string | null
  bio: string | null
  tradingStrategy: string | null
  yearsTrading: number | null
  social: Record<string, string> | null
  privacy: Record<string, unknown> | null
  theme: Record<string, unknown> | null
  calculations: Record<string, unknown> | null
  orderGrouping: Record<string, unknown> | null
  notifications: Record<string, unknown> | null
  preferences: Record<string, unknown> | null
}

export function resolveSettings(row: UserSettingsRow | null | undefined): ResolvedSettings {
  const privacy = merge(DEFAULT_PRIVACY, row?.privacy)
  privacy.retention = merge(DEFAULT_PRIVACY.retention, (row?.privacy as { retention?: unknown } | null)?.retention)
  return {
    username: row?.username ?? null,
    bio: row?.bio ?? null,
    tradingStrategy: row?.tradingStrategy ?? null,
    yearsTrading: row?.yearsTrading ?? null,
    social: merge(DEFAULT_SOCIAL, row?.social),
    privacy,
    theme: merge(DEFAULT_THEME, row?.theme),
    calculations: merge(DEFAULT_CALCULATIONS, row?.calculations),
    orderGrouping: merge(DEFAULT_ORDER_GROUPING, row?.orderGrouping),
    notifications: merge(DEFAULT_NOTIFICATIONS, row?.notifications),
    preferences: merge(DEFAULT_PREFERENCES, row?.preferences),
  }
}
