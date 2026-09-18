import { pgTable, text, timestamp, boolean, serial, numeric, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core"

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
})

// --- App tables ------------------------------------------------------------

// Trading accounts let a user track multiple broker/prop accounts separately.
export const tradingAccounts = pgTable("trading_accounts", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name").notNull(),
  broker: text("broker"),
  startingBalance: numeric("startingBalance", { precision: 18, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  // Broker-reported balance, refreshed on connect/sync for accounts linked to
  // a live source (e.g. MetaApi). Null for manual/CSV-imported accounts,
  // which fall back to startingBalance + net P&L from imported trades.
  currentBalance: numeric("currentBalance", { precision: 18, scale: 2 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// One public share link per (account, trading day) — re-sharing the same day
// rotates the token rather than creating duplicates. The card's numbers are
// computed live from trades at view time, not frozen at share time, so an
// edited/deleted trade is reflected immediately. accountId is null for an
// "all accounts" certificate — the (userId, accountId, date) lookup for that
// case is done in application code (app/actions/daily-pnl-share.ts) since a
// DB unique index can't dedupe on a nullable column the way we need here.
export const dailyPnlShares = pgTable("daily_pnl_shares", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  accountId: integer("accountId"),
  date: text("date").notNull(), // YYYY-MM-DD — the period's first day
  period: text("period").notNull().default("daily"), // daily | weekly
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Saved dashboard layouts. A trader can keep several templates (e.g. one for
// risk review, one for daily P&L) and switch between them; exactly one row per
// user carries isActive, enforced in application code since Postgres has no
// partial-unique helper in drizzle's builder here. Widget ids are validated
// against lib/dashboard-widgets.ts on both write and read, so a template can't
// pin a widget that no longer exists.
export const dashboardTemplates = pgTable("dashboard_templates", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name").notNull(),
  statWidgets: jsonb("statWidgets").$type<string[]>().notNull(),
  panelWidgets: jsonb("panelWidgets").$type<string[]>().notNull(),
  isActive: boolean("isActive").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// Public links for a payout certificate. One row per (userId, period,
// periodStart); re-sharing the same window rotates the token instead of
// piling up rows. periodStart is the window's first day, which is enough to
// rebuild the exact window later (lib/payout-period.ts resolves the same
// month, or the same 1st–15th / 16th–EOM half, from any day inside it).
// Amounts are recomputed live from prop_firm_transactions at view time, so a
// payout logged or corrected after sharing shows up immediately.
export const payoutShares = pgTable("payout_shares", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  period: text("period").notNull(), // monthly | biweekly
  periodStart: text("periodStart").notNull(), // YYYY-MM-DD
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Optional per-account prop firm evaluation rules — entered by the user for
// their specific firm/program (never hardcoded per-firm here, since exact
// numbers vary by firm, account size, and change over time). Pass/breach
// status is computed live from these + the account's own closed trades
// (lib/propfirm-rules.ts), not cached, so it's always current with the
// latest synced trades.
export const propFirmRules = pgTable("prop_firm_rules", {
  id: serial("id").primaryKey(),
  accountId: integer("accountId").notNull().unique(),
  userId: text("userId").notNull(),
  firmName: text("firmName"), // free text or a lib/propfirm-presets.ts firm name — powers the "by firm" breakdowns
  planType: text("planType"), // e.g. "Evaluation — Intraday" — the preset's `program`, or free text
  phase: text("phase").notNull().default("evaluation"), // evaluation | verification | funded
  profitTargetPct: numeric("profitTargetPct", { precision: 6, scale: 2 }), // null = no target (e.g. funded)
  maxDrawdownPct: numeric("maxDrawdownPct", { precision: 6, scale: 2 }).notNull(),
  drawdownType: text("drawdownType").notNull().default("trailing"), // trailing | static
  dailyLossLimitPct: numeric("dailyLossLimitPct", { precision: 6, scale: 2 }), // null = no daily limit
  minTradingDays: integer("minTradingDays"), // null = no minimum
  // Dollar P&L that happened before this account was added to the tracker
  // (e.g. entered as "current balance: $52,000" against a $50,000 starting
  // size) — applied once as an opening offset in the evaluation walk so
  // progress/drawdown reflect where the account actually is today. Can't
  // reconstruct the exact pre-tracking peak or daily-loss history, so this
  // is a best-effort correction, not a full backfill.
  openingBalanceAdjustment: numeric("openingBalanceAdjustment", { precision: 18, scale: 2 }),
  // Set by the user when an account is breached — the human root cause (e.g.
  // "Revenge trading") behind whichever mechanical rule actually triggered
  // it, so breach analytics can surface patterns across accounts.
  breachReasonTag: text("breachReasonTag"),
  // True when firmName/planType/rules were guessed automatically from the
  // Rithmic system name at connect time (app/actions/rithmic.ts), rather
  // than entered/confirmed by the user via savePropFirmRules — lets the UI
  // nudge "verify this" without blocking automatic tracking.
  autoDetected: boolean("autoDetected").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Money in/out for a prop-firm-tracked account — evaluation fees, resets,
// and payouts received. This is what powers the financial dashboard (total
// spent/earned, ROI, per-firm breakdown); none of it is inferred from
// trades, since evaluation fees and payouts aren't part of the trade ledger.
export const propFirmTransactions = pgTable("prop_firm_transactions", {
  id: serial("id").primaryKey(),
  accountId: integer("accountId").notNull(),
  userId: text("userId").notNull(),
  type: text("type").notNull(), // cost | payout
  category: text("category"), // cost: evaluation_fee | reset_fee | activation_fee | other
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  occurredAt: timestamp("occurredAt").notNull().defaultNow(),
  note: text("note"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Live MetaTrader connection via MetaApi.cloud. Only a read-only token
// scoped to this one account is stored (encrypted) — the admin token used to
// create the account, and the investor password, are both used once at
// connect time and never persisted. See lib/metaapi-client.ts#provisionAccount.
export const metatraderConnections = pgTable("metatrader_connections", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  accountId: integer("accountId"), // links to trading_accounts
  metaApiAccountId: text("metaApiAccountId").notNull(),
  tokenEnc: text("tokenEnc").notNull(),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  login: text("login").notNull(),
  server: text("server").notNull(),
  platform: text("platform").notNull(), // mt4 | mt5
  lastSyncFrom: timestamp("lastSyncFrom"), // deals are fetched from here forward on each sync
  lastSyncedAt: timestamp("lastSyncedAt"),
  lastSyncStatus: text("lastSyncStatus"), // ok | error
  lastSyncError: text("lastSyncError"),
  lastSyncCount: integer("lastSyncCount"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Live Rithmic sync — a direct R|Protocol (WebSocket + Protobuf) connection,
// no third-party token broker involved, so the encrypted password is the
// credential itself rather than a scoped read-only token.
export const rithmicConnections = pgTable("rithmic_connections", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  accountId: integer("accountId"), // links to trading_accounts
  systemName: text("systemName").notNull(), // which prop firm/broker "system" on Rithmic's network
  gatewayUri: text("gatewayUri").notNull(), // resolved via RequestRithmicSystemGatewayInfo at connect time
  fcmId: text("fcmId").notNull(),
  ibId: text("ibId").notNull(),
  rithmicAccountId: text("rithmicAccountId").notNull(),
  accountName: text("accountName").notNull(),
  login: text("login").notNull(),
  passwordEnc: text("passwordEnc").notNull(),
  lastSyncFrom: timestamp("lastSyncFrom"),
  lastSyncedAt: timestamp("lastSyncedAt"),
  lastSyncStatus: text("lastSyncStatus"), // ok | error
  lastSyncError: text("lastSyncError"),
  lastSyncCount: integer("lastSyncCount"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Playbooks are named strategies with a checklist of rules.
export const playbooks = pgTable("playbooks", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  rules: jsonb("rules").$type<string[]>().notNull().default([]),
  // Set when the owner turns sharing on — anyone with this token can view
  // (and clone) the playbook's strategy at /p/<token>. Never exposes trades.
  shareToken: text("shareToken").unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Direct playbook shares with other TradeLoop users (by email) — separate
// from the public link above. Recipients see the playbook read-only in
// their own "Shared Playbook" tab and can save their own copy of it.
export const playbookShares = pgTable(
  "playbook_shares",
  {
    id: serial("id").primaryKey(),
    playbookId: integer("playbookId").notNull(),
    ownerId: text("ownerId").notNull(),
    sharedWithUserId: text("sharedWithUserId").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("playbook_shares_unique").on(table.playbookId, table.sharedWithUserId)],
)

// Custom tagging system: user-defined groups (e.g. "Setups", "Mistakes")
// each holding a set of tag options, used to populate the tag/mistake
// pickers when logging a trade.
export const tagGroups = pgTable("tag_groups", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("violet"),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export const tagOptions = pgTable("tag_options", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  groupId: integer("groupId").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Core trade log. Supports futures, stocks, options, forex, crypto.
export const trades = pgTable(
  "trades",
  {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  accountId: integer("accountId"),
  playbookId: integer("playbookId"),
  symbol: text("symbol").notNull(),
  market: text("market").notNull().default("futures"), // futures | stocks | options | forex | crypto
  side: text("side").notNull().default("long"), // long | short
  status: text("status").notNull().default("closed"), // open | closed
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  entryPrice: numeric("entryPrice", { precision: 18, scale: 6 }).notNull().default("0"),
  exitPrice: numeric("exitPrice", { precision: 18, scale: 6 }),
  stopLoss: numeric("stopLoss", { precision: 18, scale: 6 }),
  takeProfit: numeric("takeProfit", { precision: 18, scale: 6 }),
  fees: numeric("fees", { precision: 18, scale: 2 }).notNull().default("0"),
  pnl: numeric("pnl", { precision: 18, scale: 2 }).notNull().default("0"),
  rMultiple: numeric("rMultiple", { precision: 10, scale: 2 }),
  // futures contract multiplier / point value (e.g. ES = 50, MES = 5)
  contractMultiplier: numeric("contractMultiplier", { precision: 18, scale: 4 }).notNull().default("1"),
  // Futures/future-option contract expiration (last trade date) — informational only, not used in P&L math.
  expirationDate: timestamp("expirationDate"),
  entryTime: timestamp("entryTime").notNull().defaultNow(),
  exitTime: timestamp("exitTime"),
  rating: integer("rating"), // 1-5 execution grade
  mistakes: jsonb("mistakes").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  // Set for CSV-imported trades (e.g. "tradovate:<account>:<contract>:<closingOrderId>")
  // so re-importing the same file skips trades it already imported. Unique
  // per account (not globally) — the same underlying broker fill can be
  // legitimately imported into more than one app account.
  externalId: text("externalId"),
  // Set when the user generates a public share link for this trade's P&L card.
  shareToken: text("shareToken").unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("trades_account_external_unique").on(table.accountId, table.externalId)],
)

// Automated + manual daily journal entries, one per trading day.
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  // auto-generated summary derived from that day's trades
  autoSummary: text("autoSummary"),
  // user's own reflection
  notes: text("notes"),
  mood: text("mood"), // e.g. calm | anxious | confident | frustrated
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Whop subscription state, kept in sync via the /api/webhooks/whop handler.
// userId is nullable — a payment can arrive before we can match it to an
// account (matched by email at webhook time), and matching is re-attempted
// wherever gating is checked.
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("userId"),
  email: text("email").notNull(),
  plan: text("plan").notNull(), // essential | pro
  status: text("status").notNull(), // active | trialing | past_due | canceled | expired | ...
  whopMembershipId: text("whopMembershipId").unique(),
  whopPlanId: text("whopPlanId"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})
