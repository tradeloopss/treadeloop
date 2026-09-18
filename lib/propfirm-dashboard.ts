// Pure aggregation over prop-firm accounts + logged transactions — kept
// separate from the server action so the math is unit-testable on its own.
import type { PropFirmAccount, PropFirmTransaction } from "@/app/actions/propfirm"

export interface FirmBreakdown {
  key: string
  spent: number
  earned: number
  net: number
}

export interface ExpenseBreakdown {
  key: string
  amount: number
}

export interface PassInsight {
  key: string
  passed: number
  attempted: number
}

export interface BreachInsight {
  reason: string
  count: number
}

export interface BreachBucket {
  count: number
  reasons: BreachInsight[]
  avgDaysBeforeBreach: number | null
  avgPnlBeforeBreach: number | null
  mostCommonFirm: string | null
  mostCommonSize: string | null
}

export interface RoiPoint {
  date: string
  cumulativeSpent: number
  cumulativeEarned: number
  cumulativeNet: number
}

export interface PropFirmDashboardData {
  totalSpent: number
  totalEarned: number
  netTotal: number
  roiPct: number | null
  fundedCount: number
  fundedBalance: number
  evaluationCount: number
  evaluationBalance: number
  byFirm: FirmBreakdown[]
  byAccountType: FirmBreakdown[]
  byAccountSize: FirmBreakdown[]
  expenseBreakdown: ExpenseBreakdown[]
  passRateByFirm: PassInsight[]
  passRateByPlanType: PassInsight[]
  passRateBySize: PassInsight[]
  breachByPhase: { evaluation: BreachBucket; funded: BreachBucket }
  roiSeries: RoiPoint[]
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  evaluation_fee: "Evaluation fee",
  reset_fee: "Reset fee",
  activation_fee: "Activation fee",
  other: "Other",
}

function sizeBucket(startingBalance: number): string {
  if (startingBalance <= 30_000) return "$25K"
  if (startingBalance <= 60_000) return "$50K"
  if (startingBalance <= 120_000) return "$100K"
  if (startingBalance <= 175_000) return "$150K"
  return "$250K+"
}

function mode(values: string[]): string | null {
  if (values.length === 0) return null
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function buildFinanceBreakdown(
  accounts: PropFirmAccount[],
  spentByAccount: Map<number, number>,
  earnedByAccount: Map<number, number>,
  keyFn: (a: PropFirmAccount) => string
): FirmBreakdown[] {
  const map = new Map<string, FirmBreakdown>()
  for (const account of accounts) {
    const key = keyFn(account)
    const spent = spentByAccount.get(account.id) ?? 0
    const earned = earnedByAccount.get(account.id) ?? 0
    if (spent === 0 && earned === 0) continue
    const existing = map.get(key) ?? { key, spent: 0, earned: 0, net: 0 }
    existing.spent += spent
    existing.earned += earned
    existing.net = existing.earned - existing.spent
    map.set(key, existing)
  }
  return [...map.values()].sort((a, b) => b.net - a.net)
}

function buildBreachBucket(accountsInBucket: PropFirmAccount[]): BreachBucket {
  const reasonCounts = new Map<string, number>()
  for (const account of accountsInBucket) {
    if (!account.breachReasonTag) continue
    reasonCounts.set(account.breachReasonTag, (reasonCounts.get(account.breachReasonTag) ?? 0) + 1)
  }
  return {
    count: accountsInBucket.length,
    reasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    avgDaysBeforeBreach: average(accountsInBucket.map((a) => a.evaluation!.daysToBreachOrPass).filter((v): v is number => v != null)),
    avgPnlBeforeBreach: average(accountsInBucket.map((a) => a.evaluation!.netProfitAtBreach).filter((v): v is number => v != null)),
    mostCommonFirm: mode(accountsInBucket.map((a) => a.firmName ?? "Unassigned")),
    mostCommonSize: mode(accountsInBucket.map((a) => sizeBucket(a.startingBalance))),
  }
}

export function buildPropFirmDashboard(
  accounts: PropFirmAccount[],
  transactions: PropFirmTransaction[]
): PropFirmDashboardData {
  const totalSpent = transactions.filter((t) => t.type === "cost").reduce((sum, t) => sum + t.amount, 0)
  const totalEarned = transactions.filter((t) => t.type === "payout").reduce((sum, t) => sum + t.amount, 0)
  const netTotal = totalEarned - totalSpent
  const roiPct = totalSpent > 0 ? (netTotal / totalSpent) * 100 : null

  const tracked = accounts.filter((a) => a.rules != null && a.evaluation != null)
  const funded = tracked.filter((a) => a.rules!.phase === "funded")
  const evaluating = tracked.filter((a) => a.rules!.phase !== "funded")

  const spentByAccount = new Map<number, number>()
  const earnedByAccount = new Map<number, number>()
  for (const t of transactions) {
    const map = t.type === "cost" ? spentByAccount : earnedByAccount
    map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amount)
  }

  const expenseMap = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== "cost") continue
    const key = EXPENSE_CATEGORY_LABELS[t.category ?? "other"] ?? "Other"
    expenseMap.set(key, (expenseMap.get(key) ?? 0) + t.amount)
  }

  const resolved = tracked.filter((a) => a.evaluation!.status === "passed" || a.evaluation!.status === "breached")

  function passRateBy(keyFn: (a: PropFirmAccount) => string): PassInsight[] {
    const map = new Map<string, PassInsight>()
    for (const account of resolved) {
      const key = keyFn(account)
      const entry = map.get(key) ?? { key, passed: 0, attempted: 0 }
      entry.attempted += 1
      if (account.evaluation!.status === "passed") entry.passed += 1
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.attempted - a.attempted)
  }

  const breachedAccounts = tracked.filter((a) => a.evaluation!.status === "breached")
  const evaluationBreaches = breachedAccounts.filter((a) => a.rules!.phase !== "funded")
  const fundedBreaches = breachedAccounts.filter((a) => a.rules!.phase === "funded")

  const roiSeries: RoiPoint[] = []
  const sortedTx = [...transactions].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
  let runningSpent = 0
  let runningEarned = 0
  for (const t of sortedTx) {
    if (t.type === "cost") runningSpent += t.amount
    else runningEarned += t.amount
    roiSeries.push({
      date: t.occurredAt.slice(0, 10),
      cumulativeSpent: runningSpent,
      cumulativeEarned: runningEarned,
      cumulativeNet: runningEarned - runningSpent,
    })
  }

  return {
    totalSpent,
    totalEarned,
    netTotal,
    roiPct,
    fundedCount: funded.length,
    fundedBalance: funded.reduce((sum, a) => sum + a.startingBalance, 0),
    evaluationCount: evaluating.length,
    evaluationBalance: evaluating.reduce((sum, a) => sum + a.startingBalance, 0),
    byFirm: buildFinanceBreakdown(accounts, spentByAccount, earnedByAccount, (a) => a.firmName ?? "Unassigned"),
    byAccountType: buildFinanceBreakdown(accounts, spentByAccount, earnedByAccount, (a) => a.planType ?? "Unspecified"),
    byAccountSize: buildFinanceBreakdown(accounts, spentByAccount, earnedByAccount, (a) => sizeBucket(a.startingBalance)),
    expenseBreakdown: [...expenseMap.entries()].map(([key, amount]) => ({ key, amount })).sort((a, b) => b.amount - a.amount),
    passRateByFirm: passRateBy((a) => a.firmName ?? "Unassigned"),
    passRateByPlanType: passRateBy((a) => a.planType ?? "Unspecified"),
    passRateBySize: passRateBy((a) => sizeBucket(a.startingBalance)),
    breachByPhase: {
      evaluation: buildBreachBucket(evaluationBreaches),
      funded: buildBreachBucket(fundedBreaches),
    },
    roiSeries,
  }
}
