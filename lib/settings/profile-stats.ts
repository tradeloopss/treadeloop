// Pure helpers for the Profile page's stats row and achievements grid. Kept
// free of DB/React so it can be unit-tested; the server page gathers the raw
// inputs (trade days, login days, counts) and calls computeProfileStats.

export type Achievement = {
  id: string
  name: string
  description: string
  unlocked: boolean
}

export type ProfileStats = {
  entries: number
  tradingStreak: number
  backtested: number
  loginStreak: number
  achievementsUnlocked: number
  experience: number
  achievements: Achievement[]
}

// A day as YYYY-MM-DD (UTC). Exposed so the page and tests agree on bucketing.
export function ymd(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

function addDays(ymdStr: string, delta: number): string {
  const d = new Date(`${ymdStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// Current streak: consecutive days with activity counting back from today. A
// missing today doesn't break it (the day may not be over) — we start from
// yesterday in that case — but a gap before that ends the run.
export function currentStreak(days: Iterable<string>, todayYmd: string): number {
  const set = days instanceof Set ? days : new Set(days)
  let cursor = set.has(todayYmd) ? todayYmd : addDays(todayYmd, -1)
  let streak = 0
  while (set.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

export function computeProfileStats(input: {
  tradeDays: string[]
  backtested: number
  loginDays: string[]
  journalEntries: number
  entries: number
  todayYmd: string
}): ProfileStats {
  const tradingStreak = currentStreak(new Set(input.tradeDays), input.todayYmd)
  const loginStreak = currentStreak(new Set(input.loginDays), input.todayYmd)

  const achievements: Achievement[] = [
    { id: "first-trade", name: "First Steps", description: "Log your first trade", unlocked: input.entries >= 1 },
    { id: "fifty", name: "Getting Serious", description: "Log 50 trades", unlocked: input.entries >= 50 },
    { id: "century", name: "Centurion", description: "Log 100 trades", unlocked: input.entries >= 100 },
    { id: "backtester", name: "Backtester", description: "Run a backtest session", unlocked: input.backtested >= 1 },
    { id: "journaler", name: "Reflective", description: "Write 10 journal entries", unlocked: input.journalEntries >= 10 },
    { id: "streak-5", name: "In the Zone", description: "Trade 5 days in a row", unlocked: tradingStreak >= 5 },
    { id: "login-7", name: "Committed", description: "Sign in 7 days in a row", unlocked: loginStreak >= 7 },
    { id: "login-30", name: "Dedicated", description: "Sign in 30 days in a row", unlocked: loginStreak >= 30 },
  ]
  const achievementsUnlocked = achievements.filter((a) => a.unlocked).length

  // A light "XP" figure so the tile has something motivating to show.
  const experience = input.entries * 10 + input.backtested * 20 + input.journalEntries * 5 + achievementsUnlocked * 50

  return {
    entries: input.entries,
    tradingStreak,
    backtested: input.backtested,
    loginStreak,
    achievementsUnlocked,
    experience,
    achievements,
  }
}
