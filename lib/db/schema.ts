import { pgTable, text, timestamp, boolean, serial, numeric, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core"
import type { RuleConfig } from "@/lib/propmax/types"
import type { AccountEvaluation } from "@/lib/propmax/engine"
import type { Mt5Position, RithmicPosition } from "@/lib/trade-manager"
import type { GuardDecision } from "@/lib/order-execution/types"
import type { LanePlan, LaneReport } from "@/lib/copy/plan"

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
  // Average round-turn commission per contract, derived from the broker's own
  // reported commission total (Rithmic's rms_account_commission ÷ filled
  // contracts). Synced fills carry no commission, so this is what makes their
  // P&L net — every synced trade's fees = this × its quantity. Null until a
  // snapshot provides it, or for non-commission accounts.
  commissionPerContract: numeric("commissionPerContract", { precision: 18, scale: 4 }),
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
// A MetaTrader account synced by our own MT5 terminals on the sync VPS
// (worker/mt5). The app only writes the request — status "pending" plus the
// encrypted investor password; the VPS worker logs in, fills in the broker's
// details, and keeps raw deals flowing into metatrader_deals every minute,
// which lib/metatrader-sync.ts turns into trades.
export const metatraderConnections = pgTable("metatrader_connections", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  accountId: integer("accountId"), // links to trading_accounts
  // The investor (read-only) password, AES-GCM encrypted (lib/crypto).
  passwordEnc: text("passwordEnc").notNull(),
  // The master/trading password (AES-GCM), set only when the user opts an
  // account into order execution — it's what lets the bridge actually place,
  // modify and close orders (the investor password above cannot trade). Null
  // keeps the account read-only. See lib/order-execution.
  tradingPasswordEnc: text("tradingPasswordEnc"),
  // What the broker said of that password, and when: pending | checking | ok |
  // read_only | rejected (lib/order-execution/trading-check.ts). The sync
  // server asks when the password is saved, and an order's own outcome writes
  // it too. Null: no trading password, or one never checked.
  tradingCheck: text("tradingCheck"),
  tradingCheckAt: timestamp("tradingCheckAt"),
  login: text("login").notNull(),
  server: text("server").notNull(),
  platform: text("platform").notNull(), // mt4 | mt5
  // Copy Trading: what the account is in a group that is switched on (leader |
  // follower | both), set by the app; and the terminal of its own the copy lane
  // on the sync server gave it (worker/mt5/copy-lane.ts), with when the lane
  // last read it. No terminal, or a stale time, means the slower shared path.
  copyRole: text("copyRole"),
  copySlot: text("copySlot"),
  copySeenAt: timestamp("copySeenAt"),
  // On a leader: what the lane needs to copy its trades by itself the instant
  // they happen (lib/copy/plan.ts), rewritten by the engine every few seconds
  // while copying is live. Null, or past its time, and the lane only reports.
  copyPlan: jsonb("copyPlan").$type<LanePlan>(),
  // The terminal's own round trip to the broker's server, in ms, as the lane last read it.
  copyPingMs: integer("copyPingMs"),
  // pending (waiting for the worker's first login) → connected, or error
  // (login rejected / broker not supported — needs reconnecting; not retried).
  status: text("status").notNull().default("pending"),
  statusMessage: text("statusMessage"),
  // Start of the history to import on first connect; null = all of it.
  historyFrom: timestamp("historyFrom"),
  // What the broker reports for the account, refreshed every sync.
  brokerName: text("brokerName"),
  holderName: text("holderName"),
  currency: text("currency"),
  balance: numeric("balance", { precision: 18, scale: 2 }),
  equity: numeric("equity", { precision: 18, scale: 2 }),
  openPositions: integer("openPositions"),
  // The live open positions themselves (MT5 positions_get → symbol, side,
  // volume, open/current price, SL/TP, floating P&L), refreshed each sync, so
  // the Trade Manager / PropFirm Max can show running trades with real
  // unrealized P&L. Null on connections synced before this existed.
  openPositionsData: jsonb("openPositionsData").$type<Mt5Position[]>(),
  // How deal times (broker server time) map to UTC: "ny+7" (the common
  // New York close = midnight convention, UTC+2/+3 following US DST) or
  // "fixed:<seconds>". Measured by the worker from the broker's live clock.
  serverTimeZone: text("serverTimeZone"),
  // Worker scheduling: when this account is next due, and who holds it.
  nextSyncAt: timestamp("nextSyncAt"),
  leaseUntil: timestamp("leaseUntil"),
  errorCount: integer("errorCount").notNull().default(0),
  // Newest deal time on file (raw server time) — the next sync reads from a
  // little before it.
  lastDealTime: timestamp("lastDealTime"),
  // New raw deals landed at dealsChangedAt; the app turned them into trades
  // up to normalizedAt. Normalization runs while dealsChangedAt > normalizedAt.
  dealsChangedAt: timestamp("dealsChangedAt"),
  normalizedAt: timestamp("normalizedAt"),
  lastSyncedAt: timestamp("lastSyncedAt"),
  lastSyncStatus: text("lastSyncStatus"), // ok | error
  lastSyncError: text("lastSyncError"),
  lastSyncCount: integer("lastSyncCount"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Every MT5 deal exactly as the terminal reported it (`raw`), plus the fields
// normalization reads, pulled out. Kept so a normalization fix can be re-run
// over history without asking the broker again. `time` is broker server time,
// stored as-is — lib/metatrader-sync.ts converts it with serverTimeZone.
export const metatraderDeals = pgTable(
  "metatrader_deals",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connectionId").notNull(),
    ticket: text("ticket").notNull(),
    orderTicket: text("orderTicket"),
    positionId: text("positionId"),
    time: timestamp("time", { precision: 3 }).notNull(),
    type: integer("type").notNull(), // DEAL_TYPE_*: 0 buy, 1 sell, 2 balance, …
    entry: integer("entry").notNull(), // DEAL_ENTRY_*: 0 in, 1 out, 2 in/out, 3 out by
    symbol: text("symbol"),
    volume: numeric("volume", { precision: 18, scale: 4 }).notNull().default("0"),
    price: numeric("price", { precision: 18, scale: 6 }).notNull().default("0"),
    profit: numeric("profit", { precision: 18, scale: 2 }).notNull().default("0"),
    commission: numeric("commission", { precision: 18, scale: 2 }).notNull().default("0"),
    swap: numeric("swap", { precision: 18, scale: 2 }).notNull().default("0"),
    fee: numeric("fee", { precision: 18, scale: 2 }).notNull().default("0"),
    // Stop loss / take profit of the order that opened it, when known — for R.
    stopLoss: numeric("stopLoss", { precision: 18, scale: 6 }),
    takeProfit: numeric("takeProfit", { precision: 18, scale: 6 }),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("metatrader_deals_connection_ticket").on(t.connectionId, t.ticket),
    index("metatrader_deals_connection_position").on(t.connectionId, t.positionId),
    index("metatrader_deals_connection_created").on(t.connectionId, t.createdAt),
  ],
)

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
  // Live open futures positions from the P&L-plant snapshot (symbol, exchange,
  // signed net qty, avg fill price, floating P&L), refreshed each sync — for
  // the Trades Manager. Null before this existed.
  openPositionsData: jsonb("openPositionsData").$type<RithmicPosition[]>(),
  // Background auto-sync is paused for this connection. Prop firms (e.g.
  // Tradeify) flag an account for too many sign-in attempts, and once a login
  // is dead every background sync is just another failed sign-in — so after
  // repeated login failures the loop pauses this connection instead of feeding
  // the alarm. A manual "Sync now" still runs and clears the pause on success.
  syncPaused: boolean("syncPaused").notNull().default(false),
  syncPausedReason: text("syncPausedReason"),
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
  // HMAC of the IP that claimed the free trial on this checkout (never the raw
  // address). Set only when a trial was granted, so a later signup from the
  // same IP is offered no trial (lib/trial-ip.ts, lib/subscription.hasUsedTrial).
  trialIpHash: text("trialIpHash"),
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

// Small global key/value store for admin-tunable settings (e.g. the Rithmic
// auto-sync interval). One row per key; the value is JSON so a setting can be a
// number, string or object. Written by admins through server actions and read
// by the background sync loop.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
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

// The support desk: a ticket is opened from inside the app (by a signed-in
// user) or from the Contact Support window anywhere on the site — where the
// sender may have no account, so the ticket carries their email instead.
// Staff reply from /admin/support. Shown to people as SUP-<10000 + id>.
export const supportTickets = pgTable(
  "support_tickets",
  {
  id: serial("id").primaryKey(),
  userId: text("userId"), // null = sent without an account
  // Who to answer when there is no account (and what they typed, when there is).
  email: text("email"),
  name: text("name"),
  category: text("category"), // lib/support/request SUPPORT_CATEGORIES; null on older tickets
  page: text("page"), // host + path the request was sent from
  // HMAC of the sender's IP (lib/trial-ip), for rate limiting only.
  ipHash: text("ipHash"),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("open"), // open (needs staff) | waiting (on the user) | closed
  // Answered first: set when the ticket is opened by someone whose affiliate
  // tier includes priority support (lib/affiliates/perks).
  priority: boolean("priority").notNull().default(false),
  kind: text("kind").notNull().default("support"), // support | feature_request
  lastMessageAt: timestamp("lastMessageAt").notNull().defaultNow(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("support_tickets_email_idx").on(t.email, t.createdAt), index("support_tickets_ip_idx").on(t.ipHash, t.createdAt)]
)

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

// --- Provider-neutral broker connections (lib/providers) --------------------
// OAuth-style connections to a trading provider — Tradovate first; Rithmic,
// MT4 and MT5 keep their own connection tables for now and can move here.
// The raw data each provider reports is kept in provider_* tables below
// (idempotent by the provider's own ids), and turned into journal `trades` by
// the shared engine (lib/fill-reconstruction). Tokens are AES-256-GCM
// encrypted (lib/crypto) and never leave the server.
export const tradingConnections = pgTable(
  "trading_connections",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    provider: text("provider").notNull(), // tradovate
    environment: text("environment").notNull(), // mock | staging | production
    providerUserId: text("providerUserId").notNull(),
    providerUserName: text("providerUserName"),
    // pending (first sync due) | connected | reauth (user must reconnect) | error | disconnected
    status: text("status").notNull().default("pending"),
    statusMessage: text("statusMessage"),
    // Progress of the first sync, shown while connecting: authenticated →
    // finding_accounts → importing_orders → importing_executions →
    // building_trades → calculating_pnl → complete
    syncStage: text("syncStage"),
    accessTokenEnc: text("accessTokenEnc"),
    refreshTokenEnc: text("refreshTokenEnc"),
    tokenExpiresAt: timestamp("tokenExpiresAt"),
    refreshExpiresAt: timestamp("refreshExpiresAt"),
    // Realtime (worker): offline | connecting | live | degraded
    realtimeStatus: text("realtimeStatus").notNull().default("offline"),
    lastRealtimeEventAt: timestamp("lastRealtimeEventAt"),
    lastSyncAt: timestamp("lastSyncAt"),
    lastSyncStatus: text("lastSyncStatus"), // ok | error
    lastSyncError: text("lastSyncError"),
    lastReconciledAt: timestamp("lastReconciledAt"),
    lastReconcileSummary: jsonb("lastReconcileSummary").$type<Record<string, number>>(),
    errorCount: integer("errorCount").notNull().default(0),
    // Scheduling, leased by the sync worker (SKIP LOCKED), like MetaTrader.
    nextSyncAt: timestamp("nextSyncAt"),
    leaseUntil: timestamp("leaseUntil"),
    lastManualSyncAt: timestamp("lastManualSyncAt"),
    // New executions stored since trades were last built → the app rebuilds.
    tradesDirtyAt: timestamp("tradesDirtyAt"),
    tradesBuiltAt: timestamp("tradesBuiltAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trading_connections_user_provider_identity").on(t.userId, t.provider, t.environment, t.providerUserId),
    index("trading_connections_due").on(t.provider, t.status, t.nextSyncAt),
  ],
)

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connectionId").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(), // tradovate: demo | live
    providerAccountId: text("providerAccountId").notNull(),
    accountName: text("accountName").notNull(),
    accountType: text("accountType"),
    currency: text("currency").notNull().default("USD"),
    balance: numeric("balance", { precision: 18, scale: 2 }),
    equity: numeric("equity", { precision: 18, scale: 2 }),
    availableMargin: numeric("availableMargin", { precision: 18, scale: 2 }),
    status: text("status").notNull().default("active"), // active | inactive
    // false = "disconnect this account": kept, but no longer synced into trades.
    enabled: boolean("enabled").notNull().default(true),
    tradingAccountId: integer("tradingAccountId"), // the journal account its trades land in
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_accounts_identity").on(t.connectionId, t.environment, t.providerAccountId)],
)

export const providerOrders = pgTable(
  "provider_orders",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connectionId").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    providerOrderId: text("providerOrderId").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    symbol: text("symbol"),
    contractId: text("contractId"),
    side: text("side"), // buy | sell
    quantity: numeric("quantity", { precision: 18, scale: 4 }),
    orderType: text("orderType"),
    limitPrice: numeric("limitPrice", { precision: 18, scale: 6 }),
    stopPrice: numeric("stopPrice", { precision: 18, scale: 6 }),
    status: text("status"),
    submittedAt: timestamp("submittedAt", { precision: 3 }),
    rawData: jsonb("rawData").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_orders_identity").on(t.connectionId, t.environment, t.providerOrderId),
    index("provider_orders_account").on(t.connectionId, t.environment, t.providerAccountId),
  ],
)

// One row per execution (fill), UNIQUE by (connection, idempotencyKey): the
// provider's own execution id, or a deterministic hash when it has none
// (lib/providers/idempotency). A fill delivered twice is stored once.
export const providerExecutions = pgTable(
  "provider_executions",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connectionId").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    idempotencyKey: text("idempotencyKey").notNull(),
    providerExecutionId: text("providerExecutionId"),
    providerOrderId: text("providerOrderId"),
    providerAccountId: text("providerAccountId").notNull(),
    symbol: text("symbol").notNull(),
    contractMonth: text("contractMonth"),
    assetClass: text("assetClass").notNull().default("future"),
    side: text("side").notNull(), // buy | sell
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    price: numeric("price", { precision: 18, scale: 6 }).notNull(),
    pointValue: numeric("pointValue", { precision: 18, scale: 4 }),
    timestamp: timestamp("timestamp", { precision: 3 }).notNull(),
    commission: numeric("commission", { precision: 18, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    rawData: jsonb("rawData").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_executions_identity").on(t.connectionId, t.idempotencyKey),
    index("provider_executions_account").on(t.connectionId, t.environment, t.providerAccountId, t.timestamp),
  ],
)

// The provider's current open positions (a snapshot, replaced on each sync).
export const providerPositions = pgTable(
  "provider_positions",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connectionId").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    contractId: text("contractId").notNull(),
    symbol: text("symbol"),
    netQuantity: numeric("netQuantity", { precision: 18, scale: 4 }).notNull(),
    averagePrice: numeric("averagePrice", { precision: 18, scale: 6 }),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_positions_identity").on(t.connectionId, t.environment, t.providerAccountId, t.contractId)],
)

// A desktop add-on the trader installed — the NinjaTrader add-on first
// (lib/ninjatrader). The add-on posts its fills with this key; only a SHA-256
// hash is stored (keyHint is the last 4 characters, for telling keys apart).
// A revoked key stops working at once.
export const providerDeviceKeys = pgTable(
  "provider_device_keys",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    provider: text("provider").notNull(), // ninjatrader
    keyHash: text("keyHash").notNull(),
    keyHint: text("keyHint").notNull(),
    label: text("label"), // the computer's name, as the add-on reports it
    clientVersion: text("clientVersion"),
    lastSeenAt: timestamp("lastSeenAt"),
    lastSyncAt: timestamp("lastSyncAt"), // last time it brought new or changed fills
    lastStatus: text("lastStatus"), // ok | error
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    revokedAt: timestamp("revokedAt"),
  },
  (t) => [uniqueIndex("provider_device_keys_hash").on(t.keyHash), index("provider_device_keys_user").on(t.userId, t.provider)],
)

// A Tradovate login the trader entered to be synced through NinjaTrader on the
// VPS (lib/ninjatrader, worker/ninjatrader) — the same idea as an MT5
// connection, but the "terminal" is NinjaTrader. Tradovate offers no
// credentials-based API for prop/eval accounts, so the VPS runs NinjaTrader,
// which is a Tradovate-sanctioned connection, holds each login as a named
// connection, and the TradeLoop add-on relays that login's fills. Those fills
// still land in the provider_* tables under the user's "ninjatrader"
// trading_connection and become trades the same way (lib/tradovate/trades).
//
// The password is a full Tradovate credential (there is no read-only one), so
// it is AES-256-GCM encrypted (lib/crypto) exactly like the Rithmic password,
// used only to log the account in through NinjaTrader, and never returned to
// the browser.
export const ninjatraderConnections = pgTable(
  "ninjatrader_connections",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    username: text("username").notNull(), // the Tradovate username
    passwordEnc: text("passwordEnc").notNull(),
    // The NinjaTrader connection profile this login uses — a prop firm's
    // Tradovate connection ("Apex", "Tradeify", …) or plain "Tradovate".
    connectionKind: text("connectionKind").notNull(),
    // The unique name the VPS gives this login's NinjaTrader connection
    // ("tl-<id>"). The relay attributes each incoming account to the user by
    // this name, so two users' logins never cross.
    ntConnectionName: text("ntConnectionName").notNull(),
    // pending (entered, waiting for the VPS to provision it) → provisioning →
    // connected, or reauth (login rejected — the user re-enters) / error.
    status: text("status").notNull().default("pending"),
    statusMessage: text("statusMessage"),
    // The VPS worker's scheduling + who holds it, like metatrader_connections.
    nextSyncAt: timestamp("nextSyncAt"),
    leaseUntil: timestamp("leaseUntil"),
    errorCount: integer("errorCount").notNull().default(0),
    // The add-on last relayed a fill / saw this connection connected.
    lastSeenAt: timestamp("lastSeenAt"),
    lastFillAt: timestamp("lastFillAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ninjatrader_connections_name").on(t.ntConnectionName),
    index("ninjatrader_connections_user").on(t.userId),
    index("ninjatrader_connections_due").on(t.status, t.nextSyncAt),
  ],
)

// --- PropFirm Max ----------------------------------------------------------
// A normalized, versioned, sourced prop-firm rule catalog that feeds the
// config-driven rule engine (lib/propmax/*). It lives ALONGSIDE the old
// prop_firm_rules table (which still powers the existing /propfirm tracker) —
// nothing here replaces that; the new /propfirm-max page reads this set.
//
// The chain is: prop_firm → prop_program → prop_rule_version (the actual,
// dated, sourced rule set as engine-ready JSONB). A user's account is bound to
// one firm/program and pinned to a specific rule_version (prop_account), so a
// later rule change never silently rewrites the rules an account was judged
// under. Daily prop_snapshot rows give history; prop_alert rows are fired
// threshold crossings.

// A prop firm (catalog / reference data, shared across all users — not
// user-scoped). Seeded from lib/propfirm-presets.ts and editable by admins.
export const propFirm = pgTable(
  "prop_firm",
  {
    id: serial("id").primaryKey(),
    // Stable machine key (e.g. "apex-trader-funding") — what detection and
    // seeds match on, so renaming the display name never breaks a binding.
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    // futures | forex | multi — the asset class(es) this firm operates in,
    // for filtering the picker. Programs carry their own assetClass too.
    assetClass: text("assetClass").notNull().default("futures"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prop_firm_slug").on(t.slug)],
)

// A specific program / challenge structure within a firm (e.g. Apex's
// "Evaluation — Intraday" vs "Evaluation — EOD"). The thing a user actually
// picks; the exact numbers live one level down in prop_rule_version.
export const propProgram = pgTable(
  "prop_program",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firmId").notNull(),
    slug: text("slug").notNull(), // unique within the firm
    name: text("name").notNull(),
    assetClass: text("assetClass").notNull().default("futures"), // futures | forex
    notes: text("notes"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prop_program_firm_slug").on(t.firmId, t.slug), index("prop_program_firm").on(t.firmId)],
)

// The heart of the catalog: one dated, sourced, versioned rule set for a
// (program, account size, phase). `rules` is exactly what the engine consumes
// — a RuleConfig[] — so there's no lossy translation between storage and
// evaluation. Rules are NEVER guessed: every version records where its numbers
// came from (source*, verifiedAt, confidence) and when they took effect
// (effectiveFrom/To). A rule change is a NEW row with a bumped `version` and a
// `changeReason`, and the old row gets an `effectiveTo` — full history, so an
// account pinned to an older version keeps being judged by the rules that were
// real when it started.
export const propRuleVersion = pgTable(
  "prop_rule_version",
  {
    id: serial("id").primaryKey(),
    programId: integer("programId").notNull(),
    // The account size these figures are for (e.g. 50000). Null = size-agnostic
    // (rules expressed only as percentages that hold across sizes).
    accountSize: integer("accountSize"),
    phase: text("phase").notNull().default("evaluation"), // evaluation | verification | funded
    version: integer("version").notNull().default(1), // bumped on every change
    // The engine-ready rule set. Each RuleConfig is one rule (type + unit +
    // value + model/basis/etc). Stored as-is so lib/propmax reads it directly.
    rules: jsonb("rules").$type<RuleConfig[]>().notNull(),
    // Provenance — the audit trail the spec requires. Never left empty for a
    // published version.
    sourceName: text("sourceName").notNull(), // e.g. "Apex Trader Funding — Help Center"
    sourceUrl: text("sourceUrl"),
    sourceType: text("sourceType").notNull().default("official_rules"), // official_rules | help_center | support | third_party | inferred
    confidence: text("confidence").notNull().default("medium"), // high | medium | low
    verifiedAt: timestamp("verifiedAt"), // when a human last confirmed these against the source
    // Effectivity window. effectiveTo null = the currently-in-force version.
    effectiveFrom: timestamp("effectiveFrom").notNull().defaultNow(),
    effectiveTo: timestamp("effectiveTo"),
    changeReason: text("changeReason"), // why this version differs from the last
    // A free-text caveat carried onto the account (e.g. preset `notes` about
    // mechanics the simple model can't capture). Shown, never hidden.
    caveat: text("caveat"),
    // Which admin authored/edited it (null for seeded rows).
    createdBy: text("createdBy"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    index("prop_rule_version_program").on(t.programId),
    // The lookup detection/seeding does: newest in-force version for a
    // (program, size, phase).
    index("prop_rule_version_lookup").on(t.programId, t.accountSize, t.phase, t.effectiveTo),
  ],
)

// Binds one of a user's trading_accounts to a firm/program and PINS it to a
// specific rule_version. This is the per-user PropFirm Max record; the old
// prop_firm_rules row (if any) is left untouched. One binding per account.
export const propAccount = pgTable(
  "prop_account",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    accountId: integer("accountId").notNull(), // → trading_accounts.id
    firmId: integer("firmId"),
    programId: integer("programId"),
    // The exact rule set version this account is judged against. Pinned at
    // bind time so a later catalog change doesn't silently move the goalposts;
    // the user is offered the newer version instead.
    ruleVersionId: integer("ruleVersionId"),
    accountSize: integer("accountSize"),
    phase: text("phase").notNull().default("evaluation"), // evaluation | verification | funded
    // How the firm/program was determined and how sure we are — the engine and
    // UI show low-confidence auto-matches as "verify this", never as fact.
    detectionSource: text("detectionSource").notNull().default("manual"), // auto | manual
    detectionConfidence: text("detectionConfidence").notNull().default("high"), // high | medium | low | unknown
    // True once the user has confirmed/overridden the auto-detected match, so
    // a later re-detection won't stomp their choice.
    confirmed: boolean("confirmed").notNull().default(false),
    // active | passed | funded | breached | archived — lifecycle, set by the
    // engine (breach) or the user.
    status: text("status").notNull().default("active"),
    // Money already made/lost before this account joined the tracker, applied
    // once as an opening offset (mirrors prop_firm_rules.openingBalanceAdjustment).
    openingBalanceAdjustment: numeric("openingBalanceAdjustment", { precision: 18, scale: 2 }),
    // Set when breached: the human root cause behind the mechanical rule.
    breachReasonTag: text("breachReasonTag"),
    startedAt: timestamp("startedAt").notNull().defaultNow(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prop_account_account").on(t.accountId), index("prop_account_user").on(t.userId)],
)

// A daily point-in-time evaluation of a prop account, for history and charts
// (the equity/drawdown-over-time view, breach forensics). Written by the sync
// worker / a cron after each sync, so the tradeloop_sync role gets write
// access. `evaluation` is the whole AccountEvaluation the engine returned, so
// the detail page can replay exactly what the trader saw on any past day.
export const propSnapshot = pgTable(
  "prop_snapshot",
  {
    id: serial("id").primaryKey(),
    propAccountId: integer("propAccountId").notNull(),
    userId: text("userId").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD (the account's trading day)
    balance: numeric("balance", { precision: 18, scale: 2 }),
    equity: numeric("equity", { precision: 18, scale: 2 }),
    highWaterMark: numeric("highWaterMark", { precision: 18, scale: 2 }),
    riskStatus: text("riskStatus"), // safe | watch | warning | critical | breached | stale | unknown
    // The full engine result — rules[], risk summary, payout eligibility.
    evaluation: jsonb("evaluation").$type<AccountEvaluation>(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("prop_snapshot_account_date").on(t.propAccountId, t.date),
    index("prop_snapshot_user").on(t.userId),
  ],
)

// A fired alert — a rule crossing a threshold (WATCH→WARNING→CRITICAL→BREACH)
// or a payout milestone. Deduped by dedupeKey so the same crossing on the same
// day isn't repeated. Written by the worker/cron (tradeloop_sync) as well as
// the app, and acknowledged by the user.
export const propAlert = pgTable(
  "prop_alert",
  {
    id: serial("id").primaryKey(),
    propAccountId: integer("propAccountId").notNull(),
    userId: text("userId").notNull(),
    ruleType: text("ruleType"), // null for account-level alerts
    status: text("status").notNull(), // the level reached: watch | warning | critical | breached | ...
    severity: text("severity").notNull().default("warning"), // info | warning | soft_breach | hard_breach | account_failure
    title: text("title").notNull(),
    body: text("body").notNull(),
    percentageUsed: numeric("percentageUsed", { precision: 6, scale: 2 }),
    // "<propAccountId>:<ruleType>:<status>:<YYYY-MM-DD>" — one alert per level
    // per rule per day.
    dedupeKey: text("dedupeKey").notNull(),
    acknowledgedAt: timestamp("acknowledgedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("prop_alert_dedupe").on(t.dedupeKey),
    index("prop_alert_account").on(t.propAccountId),
    index("prop_alert_user_unack").on(t.userId, t.acknowledgedAt),
  ],
)

// --- Order execution -------------------------------------------------------
// The ONE write path from TradeLoop to a broker. The app writes a command
// (after the rule guard vets it); a per-broker executor picks it up, sends it
// and records the result. Nothing here runs unless the account has execution
// enabled (a stored trading credential), so the app stays read-only by default.
// See lib/order-execution.
export const orderCommands = pgTable(
  "order_commands",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    accountId: integer("accountId").notNull(), // trading_accounts.id
    broker: text("broker").notNull(), // mt5 | mt4 | rithmic | tradovate
    kind: text("kind").notNull(), // close | partial_close | modify | cancel | place
    // pending → sent → filled | rejected | failed; blocked (guard refused) or
    // unsupported (broker execution not wired yet) never reach a broker.
    status: text("status").notNull().default("pending"),
    // Target of the command.
    positionRef: text("positionRef"), // broker position/ticket id (close/partial/modify)
    orderRef: text("orderRef"), // pending order id (cancel / modify pending)
    symbol: text("symbol"),
    side: text("side"), // long | short (place)
    volume: numeric("volume", { precision: 18, scale: 4 }), // lots / contracts
    price: numeric("price", { precision: 18, scale: 6 }), // limit/stop (place); exit hint (close)
    stopLoss: numeric("stopLoss", { precision: 18, scale: 6 }),
    takeProfit: numeric("takeProfit", { precision: 18, scale: 6 }),
    orderType: text("orderType"), // market | limit | stop (place)
    // The rule guard's decision, kept for the audit trail.
    ruleCheck: jsonb("ruleCheck").$type<GuardDecision>(),
    // The broker's normalized reply + message.
    brokerRef: text("brokerRef"), // fill/order id the broker returned
    resultMessage: text("resultMessage"),
    brokerResult: jsonb("brokerResult"),
    // Executor scheduling: who's working it and how many tries.
    leaseUntil: timestamp("leaseUntil"),
    attempts: integer("attempts").notNull().default(0),
    // Copy Trading: which copy this order is (lib/copy/plan.ts entryRef /
    // closeRef). Unique where set (index order_commands_client_ref, in the
    // migration), so the copy lane and the app's engine can never both send
    // the same one: whoever writes the row first, the other takes it over.
    clientRef: text("clientRef"),
    // What the copy lane decided and measured, for an order it sent by itself.
    lane: jsonb("lane").$type<LaneReport>(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [
    index("order_commands_user").on(t.userId),
    // The executor's poll: pending commands for a broker, oldest first.
    index("order_commands_due").on(t.broker, t.status, t.leaseUntil),
    index("order_commands_account").on(t.accountId),
  ],
)

// One row per user holding everything the Settings section owns that isn't
// already a first-class table: the public profile (handle, bio, socials),
// privacy choices, theme preset/colors, and the JSON-shaped preference groups
// (calculations, order grouping, notifications, general preferences). Kept in
// one 1:1 table so a page reads/writes a single row; the auth `user` table is
// left to Better Auth. Every column is nullable/defaulted so a user with no
// row yet just gets defaults (see lib/settings/defaults.ts).
export const userSettings = pgTable("user_settings", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // Public @handle shown on the Security page ("Change Username"); distinct
  // from user.name, which is the display name edited on Profile.
  username: text("username"),
  bio: text("bio"),
  tradingStrategy: text("tradingStrategy"),
  yearsTrading: integer("yearsTrading"),
  // { x, tradingview, discord, website }
  social: jsonb("social").$type<Record<string, string>>(),
  // { profileVisibility, activityVisibility, dataSharing, cookieAnalytics,
  //   cookieMarketing, retention: { loginHistoryDays, oldSessionsDays, activityLogsDays } }
  privacy: jsonb("privacy").$type<Record<string, unknown>>(),
  // { preset, color, win, loss, breakeven }
  theme: jsonb("theme").$type<Record<string, unknown>>(),
  // { defaultRiskPercent, accountSizeBasis, commissionInPnl, rMultipleBasis, ... }
  calculations: jsonb("calculations").$type<Record<string, unknown>>(),
  // { groupBy, netVsGross, mergeScaleIns, ... }
  orderGrouping: jsonb("orderGrouping").$type<Record<string, unknown>>(),
  // { emailTradeImports, emailWeeklyReview, emailSecurity, emailProduct, inAppEnabled }
  notifications: jsonb("notifications").$type<Record<string, unknown>>(),
  // { timeZone, dateFormat, weekStart, numberFormat, defaultAccountId }
  preferences: jsonb("preferences").$type<Record<string, unknown>>(),
  // Staff only: their choices for the admin area (lib/admin/preferences.ts).
  // { dashboard: modern | legacy, sidebar, notify, readAt, readKeys }
  admin: jsonb("admin").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// Saved CSV column mappings for the trade importer — one row per named schema
// so a user can keep a layout per broker/platform and reuse it on import.
export const csvSchemas = pgTable(
  "csv_schemas",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    broker: text("broker"),
    // { targetField: sourceColumn } plus parsing hints under reserved keys.
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
    delimiter: text("delimiter").notNull().default(","),
    dateFormat: text("dateFormat"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("csv_schemas_user").on(t.userId)]
)

// Reusable prefilled trade entries ("Trade Templates") the Add Trade form can
// load — a saved instrument/side/size plus optional SL/TP, tags and notes.
export const tradeTemplates = pgTable(
  "trade_templates",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol"),
    side: text("side"), // long | short | null
    quantity: numeric("quantity"),
    // { stopLoss, takeProfit, tagOptionIds:[], playbookId, notes, riskPercent }
    fields: jsonb("fields").$type<Record<string, unknown>>(),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("trade_templates_user").on(t.userId)]
)

// --- Cases Drop ------------------------------------------------------------
// A limited promotional "free case" drop. Each drop has a fixed number of
// cases; each case is one pre-shuffled reward slot. A user claims one case per
// drop and receives that slot's reward as a prize code. All the sensitive
// logic (availability, one-per-user, slot assignment, expiry) is enforced in
// the DB + server transaction — see lib/cases/*.

// One promotional drop. `claimedCases` is a denormalised counter kept in step
// with the claimed slots inside the claim transaction (drops row is locked
// FOR UPDATE), so availability never races past totalCases.
export const drops = pgTable(
  "drops",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // draft | active | paused | ended
    status: text("status").notNull().default("draft"),
    totalCases: integer("totalCases").notNull(),
    claimedCases: integer("claimedCases").notNull().default(0),
    startAt: timestamp("startAt"),
    endAt: timestamp("endAt"),
    prizeExpirationDays: integer("prizeExpirationDays").notNull().default(14),
    createdBy: text("createdBy").notNull(), // admin user id, or "system" for the seed
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("drops_status").on(t.status)]
)

// The reward types a drop can hand out. `quantity` is how many of this reward
// exist in the drop; the actual per-case assignment lives in drop_reward_slots.
// `probability` is the intended share (whole percent) — informational/for the
// UI and the publish-time validation; the real distribution is the slot set.
export const dropRewards = pgTable(
  "drop_rewards",
  {
    id: serial("id").primaryKey(),
    dropId: integer("dropId").notNull(),
    name: text("name").notNull(),
    // discount | free_subscription | free_month | custom
    type: text("type").notNull(),
    discountPercent: integer("discountPercent"), // for type=discount
    subscriptionPlan: text("subscriptionPlan"), // for type=free_subscription (essential | pro)
    subscriptionMonths: integer("subscriptionMonths"), // for type=free_subscription/free_month
    quantity: integer("quantity").notNull(),
    probability: integer("probability").notNull().default(0),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("drop_rewards_drop").on(t.dropId)]
)

// One case = one reward slot. Exactly `totalCases` rows per drop, shuffled at
// seed/publish time. A claim consumes the next available slot, guaranteeing the
// final distribution is exactly the configured quantities.
export const dropRewardSlots = pgTable(
  "drop_reward_slots",
  {
    id: serial("id").primaryKey(),
    dropId: integer("dropId").notNull(),
    rewardId: integer("rewardId").notNull(),
    slotIndex: integer("slotIndex").notNull(),
    status: text("status").notNull().default("available"), // available | claimed
    claimedBy: text("claimedBy"),
    claimedAt: timestamp("claimedAt"),
  },
  (t) => [
    uniqueIndex("drop_reward_slots_drop_index").on(t.dropId, t.slotIndex),
    index("drop_reward_slots_pick").on(t.dropId, t.status),
  ]
)

// One claim per (drop, user). Holds the assigned reward, the unique prize code,
// and the individual 14-day expiry measured from this user's claim time.
export const dropClaims = pgTable(
  "drop_claims",
  {
    id: serial("id").primaryKey(),
    dropId: integer("dropId").notNull(),
    userId: text("userId").notNull(),
    rewardId: integer("rewardId").notNull(),
    rewardSlotId: integer("rewardSlotId").notNull(),
    prizeCode: text("prizeCode").notNull(),
    claimedAt: timestamp("claimedAt").notNull().defaultNow(),
    expiresAt: timestamp("expiresAt").notNull(),
    redeemedAt: timestamp("redeemedAt"),
    // active | used | expired | revoked (expired is also derived from expiresAt)
    status: text("status").notNull().default("active"),
    // How the prize was provisioned: none | fulfilled | failed. A discount
    // creates a billing promo code (fulfillmentRef = its id); a free
    // subscription grants a plan (fulfillmentRef = sub:<id>). See lib/cases/fulfill.ts.
    fulfillmentStatus: text("fulfillmentStatus").notNull().default("none"),
    fulfillmentRef: text("fulfillmentRef"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("drop_claims_drop_user").on(t.dropId, t.userId),
    uniqueIndex("drop_claims_code").on(t.prizeCode),
    index("drop_claims_user").on(t.userId),
  ]
)

// --- Affiliate / partner program -------------------------------------------
// People apply to become affiliates, share a referral link, and earn a
// commission on the subscription payments of the customers they refer. Money
// is NEVER a mutable balance: every commission, reversal, adjustment and payout
// is a row in affiliate_commissions (the ledger) and balances are derived from
// it (lib/affiliates/engine.ts). Program rules live in app_settings
// ("affiliate_program"); admin actions go to the existing admin_audit_log.

// One per user: the application and, once approved, the affiliate profile.
export const affiliates = pgTable(
  "affiliates",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    code: text("code").notNull(), // the ?ref= code
    // pending | review | approved | rejected | suspended
    status: text("status").notNull().default("pending"),
    tierId: integer("tierId"), // manual tier override; null = by paid customers
    firstName: text("firstName").notNull(),
    lastName: text("lastName").notNull(),
    email: text("email").notNull(),
    country: text("country"),
    website: text("website"),
    socials: jsonb("socials").$type<Record<string, string>>(),
    audienceSize: text("audienceSize"),
    trafficSource: text("trafficSource"),
    promotionMethod: text("promotionMethod"),
    reason: text("reason"),
    payoutHold: boolean("payoutHold").notNull().default(false),
    fraudLock: boolean("fraudLock").notNull().default(false),
    payoutCurrency: text("payoutCurrency").notNull().default("usd"),
    // Automatic payouts need BOTH: the affiliate switched them on (autoPayout)
    // and an admin has not switched them off for this affiliate
    // (autoPayoutAllowed). The payout worker re-reads both under a row lock.
    autoPayout: boolean("autoPayout").notNull().default(false),
    autoPayoutAllowed: boolean("autoPayoutAllowed").notNull().default(true),
    manualPayoutAllowed: boolean("manualPayoutAllowed").notNull().default(true),
    autoPayoutThreshold: numeric("autoPayoutThreshold"), // the affiliate's own threshold; null = the minimum
    minPayoutOverride: numeric("minPayoutOverride"), // admin: custom minimum; null = inherited
    maxPayoutOverride: numeric("maxPayoutOverride"), // admin: custom maximum; null = inherited
    // No longer read: from when an affiliate could be allowed to create their
    // own coupons. Coupons are now only ever created by an admin (or the system,
    // for the permanent code); the columns are left in place.
    couponsEnabled: boolean("couponsEnabled").notNull().default(false),
    maxCouponPercent: integer("maxCouponPercent"),
    // When the tier perk "a free TradeLoop account, for good" was given. Given
    // once: an admin who later revokes that access isn't overruled by the next run.
    freeAccountAt: timestamp("freeAccountAt"),
    notifications: jsonb("notifications").$type<Record<string, boolean>>(),
    // Which portal they use: "classic" | "v2"; null = the program default
    // (lib/affiliates/v2/config.ts decides, and whether V2 is open to them at all).
    dashboardVersion: text("dashboardVersion"),
    // Shown on the public leaderboard only if they opt in.
    leaderboardPublic: boolean("leaderboardPublic").notNull().default(false),
    rejectionReason: text("rejectionReason"),
    reviewedBy: text("reviewedBy"),
    approvedAt: timestamp("approvedAt"),
    onboardedAt: timestamp("onboardedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliates_user").on(t.userId), uniqueIndex("affiliates_code").on(t.code), index("affiliates_status").on(t.status)]
)

// Commission tiers by paid customers referred. Admin-configurable.
export const affiliateTiers = pgTable("affiliate_tiers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  minCustomers: integer("minCustomers").notNull().default(0),
  ratePercent: numeric("ratePercent").notNull(),
  // "30% for 9 months → 15% lifetime": ratePercent for each customer's first
  // introMonths, afterPercent on their payments from then on. Both null = one
  // rate throughout (lib/affiliates/engine.tierRate).
  introMonths: integer("introMonths"),
  afterPercent: numeric("afterPercent"),
  // What reaching the tier unlocks: { coupon, beta, freeAccount, prioritySupport }.
  perks: jsonb("perks").$type<Record<string, boolean>>().notNull().default({}),
  tagline: text("tagline"),
  style: text("style").notNull().default("plain"), // plain | bronze | silver | gold | diamond
  sortOrder: integer("sortOrder").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

// Custom commission rules. Priority (lib/affiliates/engine.resolveRule):
// affiliate → campaign → coupon → tier → program default.
export const affiliateRules = pgTable(
  "affiliate_rules",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(), // affiliate | campaign | coupon
    affiliateId: integer("affiliateId").notNull(),
    campaignId: integer("campaignId"),
    couponId: integer("couponId"),
    ratePercent: numeric("ratePercent").notNull(),
    durationMonths: integer("durationMonths"), // null = use the program duration
    startsAt: timestamp("startsAt"),
    endsAt: timestamp("endsAt"),
    enabled: boolean("enabled").notNull().default(true),
    note: text("note"),
    createdBy: text("createdBy"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_rules_affiliate").on(t.affiliateId)]
)

export const affiliateCampaigns = pgTable(
  "affiliate_campaigns",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    landingPage: text("landingPage").notNull().default("/"),
    utmSource: text("utmSource"),
    utmMedium: text("utmMedium"),
    utmCampaign: text("utmCampaign"),
    utmContent: text("utmContent"),
    status: text("status").notNull().default("active"), // active | archived
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_campaigns_affiliate").on(t.affiliateId)]
)

// Tracking links: one default per affiliate, plus one (or more) per campaign.
export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    campaignId: integer("campaignId"),
    token: text("token").notNull(), // the &lk= value
    landingPage: text("landingPage").notNull().default("/"),
    isDefault: boolean("isDefault").notNull().default(false),
    status: text("status").notNull().default("active"), // active | disabled
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliate_links_token").on(t.token), index("affiliate_links_affiliate").on(t.affiliateId)]
)

export const affiliateClicks = pgTable(
  "affiliate_clicks",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    campaignId: integer("campaignId"),
    linkId: integer("linkId"),
    visitorId: text("visitorId").notNull(),
    ipHash: text("ipHash"), // HMAC of the IP, never the raw address
    landingPage: text("landingPage"),
    referrer: text("referrer"),
    utmSource: text("utmSource"),
    utmMedium: text("utmMedium"),
    utmCampaign: text("utmCampaign"),
    utmContent: text("utmContent"),
    device: text("device"),
    country: text("country"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_clicks_affiliate_time").on(t.affiliateId, t.createdAt), index("affiliate_clicks_visitor").on(t.visitorId, t.affiliateId)]
)

// A referred user. UNIQUE(userId): a customer belongs to one affiliate.
export const affiliateReferrals = pgTable(
  "affiliate_referrals",
  {
    id: serial("id").primaryKey(),
    publicId: text("publicId").notNull(), // TL-49281 — shown instead of customer PII
    affiliateId: integer("affiliateId").notNull(),
    userId: text("userId").notNull(),
    campaignId: integer("campaignId"),
    linkId: integer("linkId"),
    couponId: integer("couponId"),
    clickId: integer("clickId"),
    source: text("source").notNull().default("link"), // link | coupon
    status: text("status").notNull().default("signup"), // signup | trial | active | cancelled | refunded
    plan: text("plan"),
    billing: text("billing"),
    country: text("country"),
    device: text("device"),
    landingPage: text("landingPage"),
    revenue: numeric("revenue").notNull().default("0"), // gross paid, for lists; money lives in the ledger
    clickedAt: timestamp("clickedAt"),
    firstPaymentAt: timestamp("firstPaymentAt"),
    lastPaymentAt: timestamp("lastPaymentAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliate_referrals_user").on(t.userId), uniqueIndex("affiliate_referrals_public").on(t.publicId), index("affiliate_referrals_affiliate").on(t.affiliateId, t.createdAt)]
)

// Timeline of what happened to a referral (signup, trial, payment, refund…).
export const affiliateConversions = pgTable(
  "affiliate_conversions",
  {
    id: serial("id").primaryKey(),
    referralId: integer("referralId").notNull(),
    affiliateId: integer("affiliateId").notNull(),
    type: text("type").notNull(), // signup | trial | subscription | payment | cancelled | refund | chargeback
    amount: numeric("amount"),
    paymentId: text("paymentId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    index("affiliate_conversions_referral").on(t.referralId),
    index("affiliate_conversions_affiliate_time").on(t.affiliateId, t.createdAt),
    // One row per (event type, payment/refund id): a webhook delivered twice
    // can't be counted twice. Rows without a payment id are unconstrained.
    uniqueIndex("affiliate_conversions_payment").on(t.type, t.paymentId),
  ]
)

// THE LEDGER. Signed amounts; nothing is ever deleted or edited in value.
// type: subscription | bonus | adjustment | refund | reversal | payout
// status: pending | approved | available | paid | reversed | refunded | cancelled
// idempotencyKey makes webhook retries and double-submits harmless.
export const affiliateCommissions = pgTable(
  "affiliate_commissions",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    referralId: integer("referralId"),
    type: text("type").notNull(),
    amount: numeric("amount").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status").notNull(),
    baseAmount: numeric("baseAmount"),
    ratePercent: numeric("ratePercent"),
    ruleSource: text("ruleSource"), // affiliate | campaign | coupon | tier | default
    paymentId: text("paymentId"),
    idempotencyKey: text("idempotencyKey").notNull(),
    holdUntil: timestamp("holdUntil"),
    approvedAt: timestamp("approvedAt"),
    availableAt: timestamp("availableAt"),
    paidAt: timestamp("paidAt"),
    payoutId: integer("payoutId"),
    reversesId: integer("reversesId"),
    note: text("note"),
    createdBy: text("createdBy"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("affiliate_commissions_idem").on(t.idempotencyKey),
    index("affiliate_commissions_affiliate").on(t.affiliateId, t.createdAt),
    index("affiliate_commissions_status").on(t.status, t.holdUntil),
    index("affiliate_commissions_payment").on(t.paymentId),
  ]
)

export const affiliateCoupons = pgTable(
  "affiliate_coupons",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    campaignId: integer("campaignId"),
    code: text("code").notNull(),
    discountType: text("discountType").notNull().default("percent"), // percent | fixed
    discountValue: numeric("discountValue").notNull(),
    durationMonths: integer("durationMonths").notNull().default(1),
    plan: text("plan"), // null = all plans | essential | pro
    expiresAt: timestamp("expiresAt"),
    usageLimit: integer("usageLimit"),
    uses: integer("uses").notNull().default(0),
    status: text("status").notNull().default("active"), // active | disabled
    whopPromoId: text("whopPromoId"),
    // The affiliate's one standing discount code, created by the system. They
    // can't disable it; an admin can. At most one per affiliate (partial
    // unique index affiliate_coupons_permanent, migration 0030).
    permanent: boolean("permanent").notNull().default(false),
    createdBy: text("createdBy"), // affiliate | system | the admin's user id
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliate_coupons_code").on(t.code), index("affiliate_coupons_affiliate").on(t.affiliateId)]
)

// Every transactional email, once. `key` identifies the event
// ("payout_sent:42"): a second attempt to email the same event finds the row
// and sends nothing. The row also holds what is needed to retry a delivery the
// provider didn't take, and the final result.
export const emailEvents = pgTable(
  "email_events",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    template: text("template").notNull(),
    sender: text("sender").notNull(), // the full From header
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    // queued | sending | sent | failed
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("lastError"),
    nextAttemptAt: timestamp("nextAttemptAt").notNull().defaultNow(),
    // Where a reply should go when it isn't the sender (a support request
    // forwarded to the team: replying writes to the customer).
    replyTo: text("replyTo"),
    affiliateId: integer("affiliateId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    sentAt: timestamp("sentAt"),
  },
  (t) => [uniqueIndex("email_events_key").on(t.key), index("email_events_due").on(t.status, t.nextAttemptAt)]
)

export const affiliatePayoutMethods = pgTable(
  "affiliate_payout_methods",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    type: text("type").notNull(), // paypal | wise | bank | stripe | crypto_trc20
    label: text("label").notNull(), // masked, safe to display
    nickname: text("nickname"), // the affiliate's own name for it ("Main USDT wallet")
    details: text("details").notNull(), // AES-256-GCM encrypted JSON (lib/crypto)
    // Display-safe facts only: country, currency, account type, network, asset,
    // Stripe onboarding state. Nothing that could move money.
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    // HMAC of the destination, to spot the same account/wallet being re-added.
    fingerprint: text("fingerprint"),
    isDefault: boolean("isDefault").notNull().default(false),
    // active | pending_verification | verification_required | disabled | rejected | removed
    status: text("status").notNull().default("active"),
    // A method added to an account that already had one can't be paid to
    // until this passes (the wallet-change security hold).
    holdUntil: timestamp("holdUntil"),
    // Set when an admin lifted that hold: the method can be paid to at once,
    // and counts as "on file long enough" for automatic sending.
    holdWaivedAt: timestamp("holdWaivedAt"),
    verifiedAt: timestamp("verifiedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_payout_methods_affiliate").on(t.affiliateId)]
)

export const affiliatePayouts = pgTable(
  "affiliate_payouts",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    amount: numeric("amount").notNull(),
    currency: text("currency").notNull().default("usd"),
    methodId: integer("methodId"),
    methodType: text("methodType").notNull(),
    methodLabel: text("methodLabel").notNull(),
    provider: text("provider").notNull().default("manual"),
    providerRef: text("providerRef"),
    // pending (awaiting approval) | queued (approved, waiting to be sent) |
    // processing | submitted | confirming | paid | failed | retry_required |
    // on_hold | cancelled | rejected | reversed
    // (lib/affiliates/payout-engine.ts holds the allowed transitions)
    status: text("status").notNull().default("pending"),
    mode: text("mode").notNull().default("manual"), // manual (requested) | automatic (worker)
    fee: numeric("fee").notNull().default("0"),
    netAmount: numeric("netAmount"), // what the affiliate receives; amount − fee
    network: text("network"), // TRON, for crypto
    asset: text("asset"), // USDT, for crypto
    transactionHash: text("transactionHash"),
    idempotencyKey: text("idempotencyKey").notNull(),
    failureReason: text("failureReason"),
    note: text("note"),
    heldFrom: text("heldFrom"), // the status a hold was placed from, to return to
    attempts: integer("attempts").notNull().default(0),
    processedBy: text("processedBy"),
    approvedBy: text("approvedBy"),
    requestedAt: timestamp("requestedAt").notNull().defaultNow(),
    approvedAt: timestamp("approvedAt"),
    submittedAt: timestamp("submittedAt"),
    processedAt: timestamp("processedAt"),
    completedAt: timestamp("completedAt"),
    failedAt: timestamp("failedAt"),
    lastCheckedAt: timestamp("lastCheckedAt"),
  },
  (t) => [
    uniqueIndex("affiliate_payouts_idem").on(t.idempotencyKey),
    // One on-chain transaction can settle one payout, ever.
    uniqueIndex("affiliate_payouts_tx").on(t.transactionHash),
    index("affiliate_payouts_affiliate").on(t.affiliateId, t.requestedAt),
    index("affiliate_payouts_status").on(t.status),
  ]
)

// Every attempt to move the money for a payout: a provider transfer or an
// on-chain transaction. What the provider / the chain says here is what
// decides whether a payout is complete — never the browser.
export const affiliatePayoutTransactions = pgTable(
  "affiliate_payout_transactions",
  {
    id: serial("id").primaryKey(),
    payoutId: integer("payoutId").notNull(),
    provider: text("provider").notNull(),
    providerTransactionId: text("providerTransactionId"),
    network: text("network"), // TRON
    asset: text("asset"), // USDT
    amount: numeric("amount").notNull(),
    destination: text("destination").notNull(), // masked
    transactionHash: text("transactionHash"),
    // For a transaction this app signed: the signed bytes (so the SAME
    // transaction can be re-broadcast, never a second one) and when it expires
    // (after which, if it isn't on-chain, it provably never will be).
    signedTx: text("signedTx"),
    expiresAt: timestamp("expiresAt"),
    // signed | submitted | confirming | confirmed | failed | not_found | expired | replaced
    status: text("status").notNull().default("submitted"),
    failureReason: text("failureReason"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    submittedAt: timestamp("submittedAt"),
    confirmedAt: timestamp("confirmedAt"),
  },
  (t) => [index("affiliate_payout_tx_payout").on(t.payoutId), uniqueIndex("affiliate_payout_tx_hash").on(t.transactionHash)]
)

// The payout audit trail: who did what to which payout or payout method,
// with the before/after and the reason. Affiliate, admin and system actions
// all land here (admin ones are also in admin_audit_log).
export const affiliatePayoutEvents = pgTable(
  "affiliate_payout_events",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    payoutId: integer("payoutId"),
    methodId: integer("methodId"),
    actorType: text("actorType").notNull(), // affiliate | admin | system
    actorId: text("actorId"),
    action: text("action").notNull(),
    previous: jsonb("previous").$type<Record<string, unknown>>(),
    next: jsonb("next").$type<Record<string, unknown>>(),
    reason: text("reason"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_payout_events_affiliate").on(t.affiliateId, t.createdAt), index("affiliate_payout_events_payout").on(t.payoutId)]
)

// Risk signals for a human to review — never an automatic verdict.
export const affiliateFraudSignals = pgTable(
  "affiliate_fraud_signals",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    referralId: integer("referralId"),
    type: text("type").notNull(),
    risk: text("risk").notNull().default("low"), // low | medium | high
    details: jsonb("details").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("open"), // open | reviewing | cleared | actioned
    dedupeKey: text("dedupeKey").notNull(),
    resolvedBy: text("resolvedBy"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliate_fraud_dedupe").on(t.dedupeKey), index("affiliate_fraud_status").on(t.status, t.createdAt)]
)

export const affiliateNotifications = pgTable(
  "affiliate_notifications",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_notifications_affiliate").on(t.affiliateId, t.createdAt)]
)

// What affiliates think of the V2 dashboard beta (the Feedback window).
export const affiliateFeedback = pgTable(
  "affiliate_feedback",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    rating: text("rating").notNull(), // love | good | improve | difficult
    message: text("message"),
    page: text("page"), // the portal page it was sent from
    version: text("version").notNull().default("v2"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_feedback_created").on(t.createdAt), index("affiliate_feedback_affiliate").on(t.affiliateId, t.createdAt)]
)

// A verification code asked for before a payout is confirmed or a payout
// method is added (lib/affiliates/action-codes.ts). An emailed code is kept
// only as a keyed hash; for an authenticator code nothing is kept — the row
// then only counts the wrong tries.
export const affiliateActionCodes = pgTable(
  "affiliate_action_codes",
  {
    id: serial("id").primaryKey(),
    affiliateId: integer("affiliateId").notNull(),
    purpose: text("purpose").notNull(), // payout | method
    channel: text("channel").notNull(), // email | app
    // What exactly the code is for ("12:10.00" = method 12, $10.00): a code
    // asked for one payout can't confirm a different one.
    subject: text("subject").notNull().default(""),
    codeHash: text("codeHash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("affiliate_action_codes_affiliate").on(t.affiliateId, t.purpose, t.createdAt)]
)

export const affiliateResources = pgTable("affiliate_resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(), // brand | social | creative | product | video | copy
  url: text("url"), // the downloadable asset
  previewUrl: text("previewUrl"),
  content: text("content"), // ready-to-paste copy
  published: boolean("published").notNull().default(true),
  sortOrder: integer("sortOrder").notNull().default(0),
  createdBy: text("createdBy"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const affiliateAnnouncements = pgTable("affiliate_announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("update"),
  summary: text("summary"),
  content: text("content").notNull(),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("publishedAt"),
  createdBy: text("createdBy"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const affiliateAnnouncementReads = pgTable(
  "affiliate_announcement_reads",
  {
    id: serial("id").primaryKey(),
    announcementId: integer("announcementId").notNull(),
    affiliateId: integer("affiliateId").notNull(),
    readAt: timestamp("readAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliate_announcement_reads_pair").on(t.announcementId, t.affiliateId)]
)

// --- Edge Lab and Psychology (beta) -------------------------------------------
// Nothing here copies a trade: every table hangs off the existing `trades` row
// by its id, or holds something the trader saved.

// What a trader said about one trade: before it (the pre-trade check-in) and
// after it (the post-trade review). One row per trade.
export const tradePsychology = pgTable(
  "trade_psychology",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    tradeId: integer("tradeId").notNull(),
    emotionBefore: text("emotionBefore"),
    confidenceBefore: integer("confidenceBefore"), // 1-10
    focusBefore: integer("focusBefore"),
    stressBefore: integer("stressBefore"),
    reason: text("reason"), // why the trade was taken (valid_setup | fomo | revenge | ...)
    planBefore: boolean("planBefore"), // "are you following your plan?" before the trade
    emotionAfter: text("emotionAfter"),
    planFollowed: boolean("planFollowed"),
    interference: jsonb("interference").$type<string[]>().notNull().default([]), // moved_sl | moved_tp | closed_early | added | revenge
    notes: text("notes"),
    checkinId: integer("checkinId"),
    reviewedAt: timestamp("reviewedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trade_psychology_trade").on(t.tradeId), index("trade_psychology_user").on(t.userId)]
)

// A check-in: before a trade (linked to the trade once it exists), or the
// day's morning / evening one.
export const psychCheckins = pgTable(
  "psych_checkins",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    kind: text("kind").notNull(), // pre_trade | morning | evening
    day: text("day").notNull(), // YYYY-MM-DD in the trader's own timezone
    emotion: text("emotion"),
    confidence: integer("confidence"),
    focus: integer("focus"),
    stress: integer("stress"),
    reason: text("reason"),
    planFollowing: boolean("planFollowing"),
    answers: jsonb("answers").$type<Record<string, string>>(),
    tradeId: integer("tradeId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("psych_checkins_user").on(t.userId, t.createdAt), index("psych_checkins_day").on(t.userId, t.kind, t.day)]
)

// An idea a trader wants tested, and what the test last said.
export const edgeHypotheses = pgTable(
  "edge_hypotheses",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    statement: text("statement"),
    conditions: jsonb("conditions").$type<Record<string, string>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("edge_hypotheses_user").on(t.userId, t.updatedAt)]
)

// An edge the trader is watching: its conditions, and how it looked when saved.
export const edgeMonitors = pgTable(
  "edge_monitors",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    conditions: jsonb("conditions").$type<Record<string, string>>().notNull(),
    baseline: jsonb("baseline").$type<Record<string, unknown>>(),
    playbookId: integer("playbookId"),
    notifyInApp: boolean("notifyInApp").notNull().default(true),
    notifyEmail: boolean("notifyEmail").notNull().default(false),
    lastStatus: text("lastStatus"),
    lastCheckedAt: timestamp("lastCheckedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("edge_monitors_user").on(t.userId, t.createdAt)]
)

export const edgeAlerts = pgTable(
  "edge_alerts",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    monitorId: integer("monitorId"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    dedupeKey: text("dedupeKey").notNull(),
    readAt: timestamp("readAt"),
    emailedAt: timestamp("emailedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("edge_alerts_dedupe").on(t.dedupeKey), index("edge_alerts_user").on(t.userId, t.createdAt)]
)

// A rule a trader set for themselves, from a leak or a behaviour pattern.
export const tradingRules = pgTable(
  "trading_rules",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    text: text("text").notNull(),
    source: text("source").notNull().default("manual"), // manual | edge_leak | psych_pattern
    conditions: jsonb("conditions").$type<Record<string, string>>(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("trading_rules_user").on(t.userId, t.createdAt)]
)

export const psychChallenges = pgTable(
  "psych_challenges",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    key: text("key").notNull(),
    days: integer("days").notNull().default(7),
    status: text("status").notNull().default("active"), // active | ended
    startedAt: timestamp("startedAt").notNull().defaultNow(),
    endedAt: timestamp("endedAt"),
  },
  (t) => [index("psych_challenges_user").on(t.userId, t.startedAt)]
)

// Results of the heavier analyses, kept until the trader's trades change
// (`fingerprint`), so a page load doesn't redo them.
export const analyticsCache = pgTable(
  "analytics_cache",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    payload: jsonb("payload").notNull(),
    computedAt: timestamp("computedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("analytics_cache_key").on(t.userId, t.key)]
)

export const featureFeedback = pgTable(
  "feature_feedback",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    feature: text("feature").notNull(),
    rating: text("rating"),
    message: text("message"),
    page: text("page"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("feature_feedback_created").on(t.createdAt)]
)

// What the market was doing on a day, per instrument, worked out from daily
// price history. Shared by every trader of that instrument.
export const marketRegimes = pgTable(
  "market_regimes",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(), // the price feed's own symbol ("NQ=F")
    day: text("day").notNull(), // YYYY-MM-DD (UTC)
    trend: text("trend").notNull(), // bullish | bearish | ranging
    volatility: text("volatility").notNull(), // high | normal | low
    range: text("range").notNull(), // expansion | normal | compression
    computedAt: timestamp("computedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("market_regimes_symbol_day").on(t.symbol, t.day)]
)

// How far a trade went for and against the trader while it was open, measured
// from price history. One row per trade; `status` says why there is no figure.
export const tradeExcursions = pgTable(
  "trade_excursions",
  {
    tradeId: integer("tradeId").primaryKey(),
    userId: text("userId").notNull(),
    mae: numeric("mae"), // price units, always >= 0
    mfe: numeric("mfe"),
    maeR: numeric("maeR"), // in units of the trade's initial risk, when it had a stop
    mfeR: numeric("mfeR"),
    timeframe: text("timeframe"),
    status: text("status").notNull().default("ok"), // ok | no_data | no_symbol | too_short
    computedAt: timestamp("computedAt").notNull().defaultNow(),
  },
  (t) => [index("trade_excursions_user").on(t.userId)]
)

// ---------------------------------------------------------------------------
// Copy Trading (migration 0041). A group has one leader account and one or
// more followers; orders to a follower go through order_commands.

export const copyGroups = pgTable(
  "copy_groups",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    leaderAccountId: integer("leaderAccountId").notNull(),
    status: text("status").notNull().default("draft"), // draft | active | paused
    timeZone: text("timeZone"), // the trader's own, for the hours and days in the copy rules
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("copy_groups_user").on(t.userId, t.createdAt)]
)

export const copyGroupFollowers = pgTable(
  "copy_group_followers",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    groupId: integer("groupId").notNull(),
    accountId: integer("accountId").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sizingMode: text("sizingMode").notNull().default("same"), // same | percentage | multiplier | risk | fixed | custom
    percentage: numeric("percentage", { precision: 12, scale: 4 }),
    multiplier: numeric("multiplier", { precision: 12, scale: 4 }),
    fixedQuantity: numeric("fixedQuantity", { precision: 18, scale: 4 }),
    riskPercentage: numeric("riskPercentage", { precision: 8, scale: 4 }),
    customFactor: numeric("customFactor", { precision: 12, scale: 4 }),
    minQuantity: numeric("minQuantity", { precision: 18, scale: 4 }),
    maxPositionSize: numeric("maxPositionSize", { precision: 18, scale: 4 }),
    maxDailyLoss: numeric("maxDailyLoss", { precision: 18, scale: 2 }),
    maxExposure: numeric("maxExposure", { precision: 8, scale: 4 }),
    roundingRule: text("roundingRule").notNull().default("nearest"), // down | up | nearest | min1
    position: integer("position").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("copy_group_followers_unique").on(t.groupId, t.accountId), index("copy_group_followers_user").on(t.userId)]
)

export const copyGroupContracts = pgTable(
  "copy_group_contracts",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    groupId: integer("groupId").notNull(),
    symbol: text("symbol").notNull(),
    root: text("root").notNull(),
    name: text("name").notNull(),
    exchange: text("exchange"),
    type: text("type").notNull(),
    expiration: text("expiration"),
    tickSize: numeric("tickSize", { precision: 18, scale: 8 }).notNull(),
    tickValue: numeric("tickValue", { precision: 18, scale: 6 }),
    pointValue: numeric("pointValue", { precision: 18, scale: 6 }),
    contractMultiplier: numeric("contractMultiplier", { precision: 18, scale: 6 }).notNull(),
    minimumQuantity: numeric("minimumQuantity", { precision: 18, scale: 4 }).notNull(),
    quantityStep: numeric("quantityStep", { precision: 18, scale: 4 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("copy_group_contracts_unique").on(t.groupId, t.symbol)]
)

export const copyRules = pgTable("copy_rules", {
  groupId: integer("groupId").primaryKey(),
  userId: text("userId").notNull(),
  marketOrders: boolean("marketOrders").notNull().default(true),
  limitOrders: boolean("limitOrders").notNull().default(true),
  stopOrders: boolean("stopOrders").notNull().default(true),
  stopLoss: boolean("stopLoss").notNull().default(true),
  takeProfit: boolean("takeProfit").notNull().default(true),
  modifications: boolean("modifications").notNull().default(true),
  partialClose: boolean("partialClose").notNull().default(true),
  fullClose: boolean("fullClose").notNull().default(true),
  cancel: boolean("cancel").notNull().default(true),
  trailingStop: boolean("trailingStop").notNull().default(true),
  direction: text("direction").notNull().default("both"), // both | long | short
  symbolScope: text("symbolScope").notNull().default("selected"), // all | selected
  hoursFrom: text("hoursFrom"),
  hoursTo: text("hoursTo"),
  days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const copyRiskLimits = pgTable("copy_risk_limits", {
  groupId: integer("groupId").primaryKey(),
  userId: text("userId").notNull(),
  defaultMode: text("defaultMode").notNull().default("same"),
  defaultRatio: numeric("defaultRatio", { precision: 12, scale: 4 }).notNull().default("1"),
  globalRiskPct: numeric("globalRiskPct", { precision: 8, scale: 4 }).notNull().default("1"),
  respectPropSync: boolean("respectPropSync").notNull().default(true),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const copySymbolMappings = pgTable(
  "copy_symbol_mappings",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    followerId: integer("followerId").notNull(),
    leaderSymbol: text("leaderSymbol").notNull(),
    followerSymbol: text("followerSymbol").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("copy_symbol_mappings_unique").on(t.followerId, t.leaderSymbol)]
)

// What a broker or prop firm lets a copier do with its accounts (lib/compliance):
// one row per published version of a provider's rule set. The newest is the one
// in force; a provider with no row uses the set built into lib/compliance/rules.ts.
// Never edited in place, never deleted.
export const providerRuleSets = pgTable(
  "provider_rule_sets",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    version: integer("version").notNull(),
    ruleSet: jsonb("ruleSet").$type<import("@/lib/compliance/rules").ProviderRuleSet>().notNull(),
    publishedById: text("publishedById").notNull(),
    publishedByEmail: text("publishedByEmail").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_rule_sets_version").on(t.provider, t.version)]
)

// Sharing a strategy with friends (lib/copy/shares.ts): a trader lets the people
// they invite copy one of their Leader accounts onto accounts of their own.
// Broker accounts only, on both sides (lib/compliance/kind.ts). One share per
// account; the link carries the token; "revoked" ends it for everyone.
export const copyShares = pgTable(
  "copy_shares",
  {
    id: serial("id").primaryKey(),
    ownerId: text("ownerId").notNull(),
    accountId: integer("accountId").notNull(),
    name: text("name").notNull(),
    token: text("token").notNull(),
    status: text("status").notNull().default("active"), // active | paused (no new friends) | revoked
    maxFriends: integer("maxFriends").notNull().default(10),
    // when the owner confirmed it is their own account with a broker, not a prop firm's
    attestedAt: timestamp("attestedAt").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("copy_shares_token").on(t.token), index("copy_shares_owner").on(t.ownerId)]
)

// Who accepted an invitation. A friend gets the trades and nothing else of the owner's.
export const copyShareMembers = pgTable(
  "copy_share_members",
  {
    id: serial("id").primaryKey(),
    shareId: integer("shareId").notNull(),
    userId: text("userId").notNull(),
    status: text("status").notNull().default("active"), // active | paused (by the owner: no copying, place kept) | removed (by the owner) | left
    // the friend lets the strategy's owner see what their copies of it came to (lib/copy/friends.ts)
    shareResults: boolean("shareResults").notNull().default(false),
    joinedAt: timestamp("joinedAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("copy_share_members_unique").on(t.shareId, t.userId), index("copy_share_members_user").on(t.userId)]
)

export const copyAccountPrefs = pgTable(
  "copy_account_prefs",
  {
    accountId: integer("accountId").primaryKey(),
    userId: text("userId").notNull(),
    role: text("role").notNull().default("unassigned"), // leader | follower | both | unassigned
    lastLatencyMs: integer("lastLatencyMs"),
    lastHeartbeatAt: timestamp("lastHeartbeatAt"),
    lastTestStatus: text("lastTestStatus"),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("copy_account_prefs_user").on(t.userId)]
)

export const copyPositions = pgTable(
  "copy_positions",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    groupId: integer("groupId").notNull(),
    accountId: integer("accountId").notNull(),
    role: text("role").notNull(), // leader | follower
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    entryPrice: numeric("entryPrice", { precision: 18, scale: 8 }),
    stopLoss: numeric("stopLoss", { precision: 18, scale: 8 }),
    takeProfit: numeric("takeProfit", { precision: 18, scale: 8 }),
    positionRef: text("positionRef"),
    leaderPositionId: integer("leaderPositionId"),
    correlationId: text("correlationId"),
    // bumped on every change the engine copies; part of each order id
    version: integer("version").notNull().default(0),
    status: text("status").notNull().default("open"), // open | closed
    simulated: boolean("simulated").notNull().default(true),
    realizedPnl: numeric("realizedPnl", { precision: 18, scale: 2 }),
    // a close that is wanted (the leader closed, or Flatten All) and not yet confirmed by the broker
    closeRequestedAt: timestamp("closeRequestedAt"),
    closeAttempts: integer("closeAttempts").notNull().default(0),
    openedAt: timestamp("openedAt").notNull().defaultNow(),
    closedAt: timestamp("closedAt"),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [index("copy_positions_group").on(t.groupId, t.status)]
)

export const copyOrders = pgTable(
  "copy_orders",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    groupId: integer("groupId").notNull(),
    correlationId: text("correlationId").notNull(),
    masterOrderId: text("masterOrderId").notNull(),
    masterAccountId: integer("masterAccountId").notNull(),
    followerAccountId: integer("followerAccountId").notNull(),
    action: text("action").notNull(),
    symbol: text("symbol").notNull(),
    leaderSymbol: text("leaderSymbol").notNull(),
    side: text("side").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    leaderQuantity: numeric("leaderQuantity", { precision: 18, scale: 4 }),
    requestedPrice: numeric("requestedPrice", { precision: 18, scale: 8 }),
    executionPrice: numeric("executionPrice", { precision: 18, scale: 8 }),
    stopLoss: numeric("stopLoss", { precision: 18, scale: 8 }),
    takeProfit: numeric("takeProfit", { precision: 18, scale: 8 }),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    decision: jsonb("decision").$type<Record<string, unknown>>(),
    slippage: numeric("slippage", { precision: 18, scale: 8 }),
    latencyMs: integer("latencyMs"),
    // TradeLoop's own share of latencyMs, when the copy lane measured it: from
    // seeing the leader's trade to the follower's order leaving. The rest is the broker.
    tradeloopMs: integer("tradeloopMs"),
    simulated: boolean("simulated").notNull().default(true),
    orderCommandId: integer("orderCommandId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("copy_orders_correlation").on(t.correlationId), index("copy_orders_group").on(t.groupId, t.createdAt), index("copy_orders_user").on(t.userId, t.createdAt)]
)

export const copyEvents = pgTable(
  "copy_events",
  {
    id: serial("id").primaryKey(),
    userId: text("userId").notNull(),
    groupId: integer("groupId"),
    accountId: integer("accountId"),
    level: text("level").notNull().default("info"), // info | success | warning | error
    code: text("code").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    action: text("action"),
    masterOrderId: text("masterOrderId"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("copy_events_user").on(t.userId, t.createdAt)]
)
