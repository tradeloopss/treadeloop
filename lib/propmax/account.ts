// PropFirm Max server data layer: turns a user's real accounts into engine
// evaluations. It reuses the canonical `trades` (realized P&L) and, where a
// broker reports them, live `provider_positions` — nothing about sync is
// duplicated here; this only READS what the existing sync already wrote. An
// account with no PropFirm Max binding yet comes back with a detection
// suggestion instead of an evaluation, so the UI can offer setup.
//
// Server-only (reads the DB) — imported from server components/actions, never
// a client component, matching the rest of lib/.
import { and, eq, inArray } from "drizzle-orm"
import { db as sharedDb } from "@/lib/db"
import {
  tradingAccounts,
  trades,
  propFirmTransactions,
  propAccount,
  propFirm,
  propProgram,
  propRuleVersion,
  providerAccounts,
  providerPositions,
  rithmicConnections,
} from "@/lib/db/schema"
import { buildContext } from "@/lib/propmax/context"
import { evaluateAccount, type RuleSet, type AccountEvaluation } from "@/lib/propmax/engine"
import type { EngineTrade, OpenPosition, RuleConfig, RuleSource } from "@/lib/propmax/types"
import { detectAccount, type Detection, type FirmCandidate } from "@/lib/propmax/detect"

type Db = typeof sharedDb
type RuleVersionRow = typeof propRuleVersion.$inferSelect

// DB source-type strings → the engine's RuleSource.type union.
function mapSourceType(t: string): RuleSource["type"] {
  switch (t) {
    case "official_rules":
      return "official_rules"
    case "help_center":
      return "official_help_center"
    case "program_docs":
      return "program_docs"
    case "third_party":
      return "propfirmmatch"
    default:
      return "other"
  }
}

function mapConfidence(c: string): RuleSource["confidence"] {
  return c === "high" || c === "low" ? c : "medium"
}

// A stored rule version → the engine's RuleSet (rules + source).
export function ruleSetFromVersion(v: RuleVersionRow): RuleSet {
  return {
    rules: (v.rules ?? []) as RuleConfig[],
    source: {
      name: v.sourceName,
      url: v.sourceUrl ?? null,
      type: mapSourceType(v.sourceType),
      verifiedAt: v.verifiedAt ? v.verifiedAt.toISOString() : null,
      confidence: mapConfidence(v.confidence),
    },
    versionLabel: `v${v.version}`,
  }
}

// The account's closed trades in engine form (realized P&L, net of fees).
async function loadEngineTrades(db: Db, accountId: number): Promise<EngineTrade[]> {
  const rows = await db
    .select({
      exitTime: trades.exitTime,
      entryTime: trades.entryTime,
      pnl: trades.pnl,
      symbol: trades.symbol,
      side: trades.side,
      quantity: trades.quantity,
    })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), eq(trades.status, "closed")))
  return rows
    .filter((t) => t.exitTime != null)
    .map((t) => ({
      exitTime: t.exitTime!.toISOString(),
      entryTime: (t.entryTime ?? t.exitTime!).toISOString(),
      pnl: Number(t.pnl),
      symbol: t.symbol,
      side: t.side === "short" ? "short" : "long",
      quantity: Number(t.quantity),
    }))
}

// Live open positions, when a broker actually reports them (Tradovate via
// provider_positions). Returns [positions, true] when this account has a
// position-reporting provider link — even with zero open positions, so the
// engine computes position rules instead of returning UNKNOWN. Returns
// [[], false] otherwise (Rithmic/MT/manual — no live position feed).
async function loadOpenPositions(db: Db, accountId: number): Promise<[OpenPosition[], boolean]> {
  const linked = await db
    .select({ connectionId: providerAccounts.connectionId, environment: providerAccounts.environment, providerAccountId: providerAccounts.providerAccountId })
    .from(providerAccounts)
    .where(and(eq(providerAccounts.tradingAccountId, accountId), eq(providerAccounts.enabled, true)))
  if (linked.length === 0) return [[], false]

  const positions: OpenPosition[] = []
  for (const l of linked) {
    const rows = await db
      .select({ symbol: providerPositions.symbol, netQuantity: providerPositions.netQuantity, contractId: providerPositions.contractId })
      .from(providerPositions)
      .where(
        and(
          eq(providerPositions.connectionId, l.connectionId),
          eq(providerPositions.environment, l.environment),
          eq(providerPositions.providerAccountId, l.providerAccountId),
        ),
      )
    for (const r of rows) {
      const qty = Number(r.netQuantity)
      if (qty === 0) continue
      positions.push({ symbol: r.symbol ?? r.contractId, side: qty > 0 ? "long" : "short", quantity: Math.abs(qty) })
    }
  }
  return [positions, true]
}

export interface PropMaxBinding {
  firmName: string | null
  programName: string | null
  phase: string
  accountSize: number | null
  detectionSource: string
  detectionConfidence: string
  confirmed: boolean
  status: string
  versionLabel: string | null
  source: RuleSource | null
  caveat: string | null
}

export interface PropMaxAccountView {
  accountId: number
  name: string
  broker: string | null
  startingBalance: number
  currency: string
  brokerBalance: number | null
  binding: PropMaxBinding | null
  evaluation: AccountEvaluation | null
  // Set when there's no binding yet — a suggestion for setup, never applied
  // automatically.
  detection: Detection | null
}

// Build the {firm, programs} candidate list for detection + the setup picker.
export async function loadCatalogCandidates(db: Db = sharedDb): Promise<FirmCandidate[]> {
  const firms = await db.select({ id: propFirm.id, slug: propFirm.slug, name: propFirm.name }).from(propFirm)
  if (firms.length === 0) return []
  const programs = await db.select({ firmId: propProgram.firmId, slug: propProgram.slug, name: propProgram.name }).from(propProgram)
  const byFirm = new Map<number, { slug: string; name: string }[]>()
  for (const p of programs) {
    const list = byFirm.get(p.firmId) ?? []
    list.push({ slug: p.slug, name: p.name })
    byFirm.set(p.firmId, list)
  }
  return firms.map((f) => ({ firmSlug: f.slug, firmName: f.name, programs: byFirm.get(f.id) ?? [] }))
}

// Evaluate one bound account against its pinned rule version.
async function evaluateBound(
  db: Db,
  account: typeof tradingAccounts.$inferSelect,
  binding: typeof propAccount.$inferSelect,
  version: RuleVersionRow,
  payouts: { at: string; amount: number }[],
): Promise<AccountEvaluation> {
  const startingBalance = Number(account.startingBalance)
  const engineTrades = await loadEngineTrades(db, account.id)
  const [openPositions, livePositionsAvailable] = await loadOpenPositions(db, account.id)

  const brokerLinked = account.currentBalance != null
  const openingAdjustment =
    binding.openingBalanceAdjustment != null
      ? Number(binding.openingBalanceAdjustment)
      : brokerLinked
        ? Number(account.currentBalance) - startingBalance - engineTrades.reduce((s, t) => s + t.pnl, 0) + payouts.reduce((s, p) => s + p.amount, 0)
        : 0

  const ctx = buildContext({
    startingBalance,
    currency: account.currency,
    openingAdjustment,
    liveBalance: brokerLinked ? Number(account.currentBalance) : null,
    trades: engineTrades,
    openPositions,
    livePositionsAvailable,
    payouts,
    lastSyncAt: brokerLinked ? account.balanceUpdatedAt : null,
  })
  return evaluateAccount(ctx, ruleSetFromVersion(version))
}

// Everything the PropFirm Max overview needs for a user: each non-archived
// account, its binding + live evaluation, or a detection suggestion when it's
// not set up yet.
export async function getPropMaxOverview(userId: string, db: Db = sharedDb): Promise<PropMaxAccountView[]> {
  const accounts = await db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, userId))
  const active = accounts.filter((a) => !a.archived)
  if (active.length === 0) return []
  const accountIds = active.map((a) => a.id)

  const bindings = await db.select().from(propAccount).where(eq(propAccount.userId, userId))
  const bindingByAccount = new Map(bindings.map((b) => [b.accountId, b]))

  const versionIds = bindings.map((b) => b.ruleVersionId).filter((v): v is number => v != null)
  const versions = versionIds.length ? await db.select().from(propRuleVersion).where(inArray(propRuleVersion.id, versionIds)) : []
  const versionById = new Map(versions.map((v) => [v.id, v]))

  const firmIds = bindings.map((b) => b.firmId).filter((v): v is number => v != null)
  const programIds = bindings.map((b) => b.programId).filter((v): v is number => v != null)
  const firms = firmIds.length ? await db.select().from(propFirm).where(inArray(propFirm.id, firmIds)) : []
  const programs = programIds.length ? await db.select().from(propProgram).where(inArray(propProgram.id, programIds)) : []
  const firmById = new Map(firms.map((f) => [f.id, f]))
  const programById = new Map(programs.map((p) => [p.id, p]))

  const payoutRows = await db
    .select({ accountId: propFirmTransactions.accountId, amount: propFirmTransactions.amount, occurredAt: propFirmTransactions.occurredAt })
    .from(propFirmTransactions)
    .where(and(eq(propFirmTransactions.userId, userId), eq(propFirmTransactions.type, "payout")))

  // Detection needs the Rithmic system name (where the login is provisioned)
  // and the catalog. Both loaded once, only if some account is unbound.
  const someUnbound = active.some((a) => !bindingByAccount.has(a.id))
  const systemByAccount = new Map<number, string>()
  let candidates: FirmCandidate[] = []
  if (someUnbound) {
    const conns = await db
      .select({ accountId: rithmicConnections.accountId, systemName: rithmicConnections.systemName })
      .from(rithmicConnections)
      .where(eq(rithmicConnections.userId, userId))
    for (const c of conns) if (c.accountId != null) systemByAccount.set(c.accountId, c.systemName)
    candidates = await loadCatalogCandidates(db)
  }

  const views: PropMaxAccountView[] = []
  for (const account of active) {
    const binding = bindingByAccount.get(account.id) ?? null
    const startingBalance = Number(account.startingBalance)
    const brokerLinked = account.currentBalance != null

    if (binding && binding.ruleVersionId != null && versionById.has(binding.ruleVersionId)) {
      const version = versionById.get(binding.ruleVersionId)!
      const payouts = payoutRows
        .filter((p) => p.accountId === account.id)
        .map((p) => ({ at: p.occurredAt.toISOString(), amount: Number(p.amount) }))
      const evaluation = await evaluateBound(db, account, binding, version, payouts)
      const firm = binding.firmId != null ? firmById.get(binding.firmId) : null
      const program = binding.programId != null ? programById.get(binding.programId) : null
      views.push({
        accountId: account.id,
        name: account.name,
        broker: account.broker,
        startingBalance,
        currency: account.currency,
        brokerBalance: brokerLinked ? Number(account.currentBalance) : null,
        binding: {
          firmName: firm?.name ?? null,
          programName: program?.name ?? null,
          phase: binding.phase,
          accountSize: binding.accountSize,
          detectionSource: binding.detectionSource,
          detectionConfidence: binding.detectionConfidence,
          confirmed: binding.confirmed,
          status: binding.status,
          versionLabel: `v${version.version}`,
          source: ruleSetFromVersion(version).source,
          caveat: version.caveat,
        },
        evaluation,
        detection: null,
      })
    } else {
      const detection = detectAccount(
        { systemName: systemByAccount.get(account.id) ?? null, broker: account.broker, startingBalance },
        candidates,
      )
      views.push({
        accountId: account.id,
        name: account.name,
        broker: account.broker,
        startingBalance,
        currency: account.currency,
        brokerBalance: brokerLinked ? Number(account.currentBalance) : null,
        binding: null,
        evaluation: null,
        detection,
      })
    }
  }

  return views
}

// One account's full detail (same shape as the overview entry).
export async function getPropMaxAccount(userId: string, accountId: number, db: Db = sharedDb): Promise<PropMaxAccountView | null> {
  const all = await getPropMaxOverview(userId, db)
  return all.find((v) => v.accountId === accountId) ?? null
}
