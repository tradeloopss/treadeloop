import { pgTable, text, timestamp, boolean, serial, numeric, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core"

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
  // Better Auth admin plugin (lib/admin/access.ts has the roles). A banned
  // user can't sign in; the admin panel calls that "Suspended".
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires"),
  // Better Auth two-factor plugin (authenticator-app codes + backup codes).
  twoFactorEnabled: boolean("twoFactorEnabled").default(false),
})

export const twoFactor = pgTable(
  "twoFactor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backupCodes").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failedVerificationCount").default(0),
    lockedUntil: timestamp("lockedUntil"),
  },
  (t) => [index("twoFactor_secret_idx").on(t.secret), index("twoFactor_userId_idx").on(t.userId)]
)

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
  // Set on sessions an admin opened with "Log in as user" (admin plugin).
  impersonatedBy: text("impersonatedBy"),
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
  // When currentBalance was last read from the broker. Null for accounts
  // whose balance was typed in by hand.
  balanceUpdatedAt: timestamp("balanceUpdatedAt"),
  // The liquidation floor the broker's risk system reports for this account
  // (Rithmic's auto-liquidate threshold / minimum account balance), when it
  // reports one — the prop firm's own trailing-drawdown line, straight from
  // the source. Null when unknown.
  brokerDrawdownFloor: numeric("brokerDrawdownFloor", { precision: 18, scale: 2 }),
  // True while startingBalance is our own guess, worked back from the
  // broker's balance (lib/broker-balance.ts). Each balance refresh re-does
  // the guess until the user types a size themselves, which clears this.
  startingBalanceInferred: boolean("startingBalanceInferred").notNull().default(false),
  // Hidden from active views (dashboard, selectors) but kept, with its trades,
  // so it can be brought back. Deleting is the permanent option.
  archived: boolean("archived").notNull().default(false),
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
  // Exact dollar thresholds, the way firms publish them. When set they take
  // precedence over the percentages above (which are kept for display and
  // for rows from before these existed); lib/propfirm-rules.ts reads both.
  profitTargetAmount: numeric("profitTargetAmount", { precision: 18, scale: 2 }),
  maxDrawdownAmount: numeric("maxDrawdownAmount", { precision: 18, scale: 2 }),
  dailyLossLimitAmount: numeric("dailyLossLimitAmount", { precision: 18, scale: 2 }),
  // Largest profitable day may be at most this % of profit (since the last
  // payout, once funded). null = no consistency rule.
  consistencyPct: numeric("consistencyPct", { precision: 6, scale: 2 }),
  // Funded-stage payout rules: qualifying days (at or above minDayProfit)
  // needed before a payout request, and the most one request can be for.
  minPayoutDays: integer("minPayoutDays"),
  minDayProfit: numeric("minDayProfit", { precision: 18, scale: 2 }),
  payoutCap: numeric("payoutCap", { precision: 18, scale: 2 }),
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

// A browser the trader has paired the TradeLoop extension in. TradingView's
// paper account lives on TradingView's servers and only the trader's own
// logged-in browser may read it, so the extension does the reading there
// and posts the fills here with this token. The token identifies the
// browser, not the TradingView account — nothing of TradingView's login is
// ever stored. lastSeenAt is null until the extension has checked in once,
// which is how the pairing page tells a fresh code from a claimed one.
export const tradingviewPairings = pgTable("tradingview_pairings", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  token: text("token").notNull().unique(),
  label: text("label"), // "Chrome on Windows" — reported by the extension
  extensionVersion: text("extensionVersion"),
  lastSeenAt: timestamp("lastSeenAt"),
  lastSyncAt: timestamp("lastSyncAt"),
  lastStatus: text("lastStatus"), // ok | error
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// One TradingView paper account's link into the journal. Two kinds share
// the table: "extension" rows are created by the paired browser extension,
// one per paper account it finds, keyed by TradingView's own account id;
// "webhook" rows are a URL we mint for a TradingView alert to post fills to
// (a paid-plan route). For a webhook the token in the URL is the whole
// credential, so it's unguessable and revocable by deleting the row; an
// extension row carries a token too, only so the column stays uniform.
export const tradingviewConnections = pgTable("tradingview_connections", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  accountId: integer("accountId").notNull(), // links to trading_accounts
  name: text("name").notNull(),
  // What TradingView symbols on this connection are when a fill doesn't say
  // itself: decides the contract multiplier and how the trade is filed. A
  // webhook connection is one market; extension fills each carry their own
  // (worked out from the exchange prefix) and fall back to this.
  market: text("market").notNull().default("stocks"),
  webhookToken: text("webhookToken").notNull().unique(),
  kind: text("kind").notNull().default("webhook"), // webhook | extension
  pairingId: integer("pairingId"), // the tradingview_pairings row that created an extension connection
  externalAccountId: text("externalAccountId"), // TradingView's paper account id (extension connections)
  lastEventAt: timestamp("lastEventAt"),
  lastStatus: text("lastStatus"), // ok | error
  lastError: text("lastError"),
  eventCount: integer("eventCount").notNull().default(0),
  tradeCount: integer("tradeCount").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Every fill a TradingView alert has reported, kept as the raw stream so
// round-trip trades can be rebuilt from scratch on each delivery (the same
// approach as a Rithmic re-sync). An alert that fires twice carries the same
// eventId, which the unique index drops.
export const tradingviewFills = pgTable(
  "tradingview_fills",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connectionId").notNull(),
    eventId: text("eventId").notNull(),
    symbol: text("symbol").notNull(),
    action: text("action").notNull(), // Buy | Sell
    quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
    price: numeric("price", { precision: 18, scale: 8 }).notNull(),
    filledAt: timestamp("filledAt").notNull(),
    // The market this fill's symbol trades on, when the source said (the
    // extension reads it off TradingView's exchange prefix). Null means
    // the connection's market applies.
    market: text("market"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tradingview_fills_event_unique").on(table.connectionId, table.eventId)],
)

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
  // Where this trade came from: backtest | rithmic | tradovate | manual | csv.
  // Null on rows created before this column existed. The whole point is that a
  // backtested trade flows into the SAME trade log/analytics as a live one but
  // stays distinguishable (and filterable) by its origin.
  source: text("source"),
  // Links a backtested trade back to the backtest_sessions row it was closed
  // in, so the session's results view can pull exactly its own trades. Null
  // for every non-backtest trade.
  backtestSessionId: integer("backtestSessionId"),
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

// A manual historical backtest / replay session. The working state that only
// matters while a replay is in progress — the open orders and the open
// position — lives here as JSONB rather than in their own tables: they're
// ephemeral, always read and written together, and never queried across
// sessions. The moment a position closes it becomes a real row in `trades`
// (source = "backtest", backtestSessionId = this id), so it flows into the
// existing journal and analytics like any other trade; nothing about results
// is duplicated here. accountId / propFirmRulesId are set only when the trader
// runs the session against one of their real accounts' prop-firm rules.
export const backtestSessions = pgTable("backtest_sessions", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name"),
  symbol: text("symbol").notNull(), // provider symbol, e.g. "NQ=F", "BTC-USD"
  market: text("market").notNull().default("futures"),
  provider: text("provider").notNull().default("yahoo"),
  timeframe: text("timeframe").notNull().default("5m"), // chart timeframe
  // Execution timeframe — the (lower) resolution the fill engine steps at to
  // resolve intrabar SL/TP order. Equal to `timeframe` for the MVP; kept as
  // its own column so a 1m/tick execution layer can be added without a schema
  // change.
  executionTimeframe: text("executionTimeframe").notNull().default("5m"),
  // The historical window this session replays, and how far the cursor has
  // advanced through it (market time, never wall-clock).
  rangeStart: timestamp("rangeStart").notNull(),
  rangeEnd: timestamp("rangeEnd").notNull(),
  currentTime: timestamp("currentTime").notNull(),
  startingBalance: numeric("startingBalance", { precision: 18, scale: 2 }).notNull().default("50000"),
  currentBalance: numeric("currentBalance", { precision: 18, scale: 2 }).notNull().default("50000"),
  speed: integer("speed").notNull().default(1), // 1 | 2 | 5 | 10 | 20
  status: text("status").notNull().default("active"), // active | paused | completed
  // True for "random date" mode — the window was chosen for the trader and the
  // dates stay hidden in the UI until the session ends.
  randomMode: boolean("randomMode").notNull().default(false),
  // Real account whose prop-firm rules to simulate, when the trader opts in.
  accountId: integer("accountId"),
  simulatePropRules: boolean("simulatePropRules").notNull().default(false),
  // Working state — see the table comment. openOrders: pending limit/stop
  // orders; openPosition: the single current position (one-position MVP).
  openOrders: jsonb("openOrders").$type<unknown[]>().notNull().default([]),
  openPosition: jsonb("openPosition").$type<unknown>(),
  // Free-form UI settings (indicators, risk %, default qty) so the workspace
  // reopens the way the trader left it.
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
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
  // monthly | annual — from the checkout; null on rows from before it was
  // recorded. Revenue estimates treat null as monthly.
  billing: text("billing"),
  // whop | admin. An admin grant is access given from the admin panel with
  // no payment behind it; it lapses at currentPeriodEnd.
  source: text("source").notNull().default("whop"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// Every action taken from the admin panel, written by lib/admin/audit.ts.
// Append-only: nothing in the app updates or deletes these rows.
export const adminAuditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  actorId: text("actorId").notNull(),
  actorEmail: text("actorEmail").notNull(),
  action: text("action").notNull(), // e.g. user.suspend, user.impersonate, plan.grant
  targetUserId: text("targetUserId"),
  details: jsonb("details"),
  ipAddress: text("ipAddress"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// App-wide banners shown at the top of every signed-in page while active.
export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  level: text("level").notNull().default("info"), // info | warning
  active: boolean("active").notNull().default(true),
  endsAt: timestamp("endsAt"),
  createdBy: text("createdBy").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Sign-ins, failed attempts, password and 2FA changes — written by the auth
// hook in lib/security.ts, read by the admin Security page.
export const securityEvents = pgTable(
  "security_events",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // sign_in | sign_in_failed | sign_in_blocked | two_factor_failed | ...
    userId: text("userId"),
    email: text("email"),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    details: jsonb("details"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("security_events_created_idx").on(t.createdAt), index("security_events_user_idx").on(t.userId)]
)

// In-app support desk: a user opens a ticket, staff reply from /admin/support.
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("open"), // open (needs staff) | waiting (on the user) | closed
  lastMessageAt: timestamp("lastMessageAt").notNull().defaultNow(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export const supportMessages = pgTable(
  "support_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticketId")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorId: text("authorId").notNull(),
    fromStaff: boolean("fromStaff").notNull().default(false),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("support_messages_ticket_idx").on(t.ticketId)]
)

// One row per CSV/report import attempt (app/actions/broker.ts). Failed
// attempts keep the uploaded file (up to 2 MB) so staff can see what the
// broker exported and re-run the import once the parser is fixed.
export const importEvents = pgTable(
  "import_events",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    source: text("source"), // Tradovate | NinjaTrader | MetaTrader 4/5 | null when unrecognized
    fileName: text("fileName"),
    fileSize: integer("fileSize"),
    status: text("status").notNull(), // imported | failed
    totalRows: integer("totalRows"),
    skippedRows: integer("skippedRows"),
    imported: integer("imported"),
    duplicates: integer("duplicates"),
    error: text("error"),
    accountId: integer("accountId"),
    fileContent: text("fileContent"),
    retryOf: integer("retryOf"),
    resolvedAt: timestamp("resolvedAt"), // a failure staff retried or dismissed
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("import_events_created_idx").on(t.createdAt), index("import_events_user_idx").on(t.userId)]
)

// Every broker sync attempt — background, the user's "Sync now", an admin's
// forced or mass re-sync, and the first sync on connect (lib/sync-runs.ts).
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    broker: text("broker").notNull(), // rithmic | metatrader
    connectionId: integer("connectionId").notNull(),
    userId: text("userId").notNull(),
    trigger: text("trigger").notNull(), // auto | manual | admin | connect
    status: text("status").notNull(), // ok | error
    imported: integer("imported"),
    error: text("error"),
    durationMs: integer("durationMs"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("sync_runs_created_idx").on(t.createdAt), index("sync_runs_connection_idx").on(t.broker, t.connectionId)]
)

// Tags and playbooks every new user starts with, editable from the admin
// panel. Copied into the user's own rows on their first sign-in
// (lib/starter-templates.ts), so later edits here don't touch existing users.
export const starterTagGroups = pgTable("starter_tag_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("violet"),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export const starterPlaybooks = pgTable("starter_playbooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rules: jsonb("rules").$type<string[]>().notNull().default([]),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Set once the starter templates have been copied for a user.
export const userOnboarding = pgTable("user_onboarding", {
  userId: text("userId").primaryKey(),
  seededAt: timestamp("seededAt").notNull().defaultNow(),
})

// One row per call to an external API (Anthropic, MetaApi) with tokens or
// units used, so the admin System page can show usage and estimated cost.
export const apiUsage = pgTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(), // anthropic | metaapi
    operation: text("operation").notNull(), // e.g. journal_narrative, fetch_snapshot
    userId: text("userId"),
    inputTokens: integer("inputTokens"),
    outputTokens: integer("outputTokens"),
    status: text("status").notNull(), // ok | error
    error: text("error"),
    durationMs: integer("durationMs"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("api_usage_created_idx").on(t.createdAt)]
)

// Server-side timing of the app's own pages and actions, sampled so the
// System page can show p50/p95 per route without a third-party APM.
export const requestTimings = pgTable(
  "request_timings",
  {
    id: serial("id").primaryKey(),
    route: text("route").notNull(),
    durationMs: integer("durationMs").notNull(),
    status: integer("status"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("request_timings_created_idx").on(t.createdAt)]
)
