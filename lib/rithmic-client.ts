// Live Rithmic sync via the R | Protocol API — WebSocket + Protocol
// Buffers, confirmed working end-to-end against Rithmic's own test gateway
// (login, account list, and fill history all verified with real credentials
// before this was written). The .proto schemas in lib/rithmic-proto/ are
// copied verbatim from Rithmic's official RProtocolAPI SDK (version
// 0.89.0.0) — template ids and field names below come directly from that
// SDK's Reference_Guide.pdf, not guessed.
//
// Rithmic isn't one network. RequestRithmicSystemInfo only lists the systems
// reachable from whichever gateway you're connected to — confirmed by
// querying two different gateways directly: the shared production gateway
// (PRODUCTION_GATEWAY below) returns the real, live list of every prop
// firm/broker on Rithmic's mainline network (Apex, Bulenox, Tradeify, etc. —
// 25 entries, fetched live, not a hardcoded guess), while the dedicated test
// gateway (TEST_GATEWAY) only knows about "Rithmic Test", a separate sandbox
// network entirely. listRithmicSystems() lets the connect UI show the real
// list for whichever gateway it's pointed at.
import fs from "node:fs"
import path from "node:path"
import WebSocket from "ws"
import protobuf from "protobufjs"
import type { ParsedFill } from "@/lib/fill-reconstruction"

// Shared production network — hosts every real, live prop firm/broker.
export const PRODUCTION_RITHMIC_GATEWAY = "wss://rprotocol.rithmic.com:443"
// Separate sandbox network used only by the "Rithmic Test" demo system —
// this app's own live testing was done against it.
export const TEST_RITHMIC_GATEWAY = "wss://rituz00100.rithmic.com:443"
const TEMPLATE_VERSION = "5.42"
const APP_NAME = "TradeLoop"
const APP_VERSION = "1.0.0"

const PROTO_DIR = path.join(process.cwd(), "lib/rithmic-proto")
const PROTO_FILES = [
  "request_login.proto",
  "response_login.proto",
  "request_login_info.proto",
  "response_login_info.proto",
  "request_account_list.proto",
  "response_account_list.proto",
  "request_show_fill_history.proto",
  "response_show_fill_history.proto",
  "request_logout.proto",
  "request_rithmic_system_info.proto",
  "response_rithmic_system_info.proto",
  "request_time_bar_replay.proto",
  "response_time_bar_replay.proto",
  // Account balance / risk limits. These five are from the same SDK, via
  // its public mirrors (github.com/rundef/async_rithmic), verified against
  // Rithmic's sandbox before use.
  "request_account_rms_info.proto",
  "response_account_rms_info.proto",
  "request_pnl_position_snapshot.proto",
  "response_pnl_position_snapshot.proto",
  "account_pnl_position_update.proto",
]

// SysInfraType per request_login.proto's enum — which login a session is
// for determines which request templates are valid on it.
const ORDER_PLANT = 2
const HISTORY_PLANT = 3
const PNL_PLANT = 4

let cachedRoot: protobuf.Root | null = null
function getRoot(): protobuf.Root {
  if (cachedRoot) return cachedRoot
  const root = new protobuf.Root()
  for (const f of PROTO_FILES) {
    const source = fs.readFileSync(path.join(PROTO_DIR, f), "utf8")
    protobuf.parse(source, root, { keepCase: false })
  }
  // Every Rithmic message carries template_id in the same field, so a
  // stream that mixes message types (the PnL snapshot) can be told apart
  // before picking the full type to decode with.
  protobuf.parse('syntax = "proto3"; package rti; message Base { int32 template_id = 154467; }', root, { keepCase: false })
  cachedRoot = root
  return root
}

function encode(root: protobuf.Root, typeName: string, obj: Record<string, unknown>): Buffer {
  const T = root.lookupType(typeName)
  return Buffer.from(T.encode(T.create(obj)).finish())
}
function decode(root: protobuf.Root, typeName: string, buf: WebSocket.RawData): any {
  return root.lookupType(typeName).decode(buf as Buffer)
}

function waitForOne(ws: WebSocket, timeoutMs = 15000): Promise<WebSocket.RawData> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Rithmic response")), timeoutMs)
    ws.once("message", (data: WebSocket.RawData) => {
      clearTimeout(timeout)
      resolve(data)
    })
  })
}

// Collects streamed response messages until one carries `rp_code` (the
// terminator) rather than `rq_handler_rp_code` (meaning "more coming") —
// this is Rithmic's own documented rule for multi-message responses.
function collectUntilRpCode(root: protobuf.Root, ws: WebSocket, typeName: string, timeoutMs = 20000): Promise<{ list: any[]; terminal: any }> {
  return new Promise((resolve, reject) => {
    const list: any[] = []
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${typeName}`)), timeoutMs)
    const onMessage = (data: WebSocket.RawData) => {
      const msg = decode(root, typeName, data)
      if (msg.rpCode && msg.rpCode.length > 0) {
        clearTimeout(timeout)
        ws.off("message", onMessage)
        resolve({ list, terminal: msg })
      } else {
        list.push(msg)
      }
    }
    ws.on("message", onMessage)
  })
}

export interface RithmicAccount {
  fcmId: string
  ibId: string
  accountId: string
  accountName: string
}

// The risk limits Rithmic's RMS enforces on an account (ResponseAccountRmsInfo).
// For a prop firm account the auto-liquidate threshold, where the firm sets
// one, is the trailing-drawdown line the firm itself liquidates at.
export interface RithmicAccountRms {
  accountId: string
  algorithm: string | null
  lossLimit: number | null
  minAccountBalance: number | null
  autoLiquidateThreshold: number | null
}

// The account's money as Rithmic sees it right now (AccountPnLPositionUpdate
// snapshot from the PnL plant). accountBalance is the settled balance the
// firm's dashboard shows; open P&L is what's floating on open positions.
export interface RithmicAccountSnapshot {
  accountId: string
  accountBalance: number
  cashOnHand: number | null
  openPositionPnl: number
  closedPositionPnl: number
  minAccountBalance: number | null
  at: Date
}

async function connect(uri: string): Promise<WebSocket> {
  const ws = new WebSocket(uri, { rejectUnauthorized: false })
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve())
    ws.once("error", reject)
  })
  return ws
}

// Lists the systems reachable from a given gateway, with no login required
// (confirmed from Rithmic's official Node.js sample, which calls
// RequestRithmicSystemInfo right after opening the socket, before any
// RequestLogin). Template id 16 comes from the Reference_Guide.pdf's
// "Templates Shared across Infrastructure Plants" table, not guessed. Only
// scoped to this one gateway — not a directory of every Rithmic-connected
// firm — which is exactly why the gateway address itself must come from the
// user's own prop firm.
export async function listRithmicSystems(gatewayUri: string): Promise<string[]> {
  const root = getRoot()
  const ws = await connect(gatewayUri)
  try {
    ws.send(encode(root, "RequestRithmicSystemInfo", { templateId: 16 }))
    const resp = decode(root, "ResponseRithmicSystemInfo", await waitForOne(ws))
    if (!(resp.rpCode.length > 0 && resp.rpCode[0] === "0")) {
      throw new Error("Could not fetch the list of Rithmic systems on that gateway")
    }
    return resp.systemName ?? []
  } finally {
    ws.close()
  }
}

// Rithmic (at least this account/tier) rejects a second login attempted too
// soon after a prior session's logout — confirmed empirically earlier by
// running two logins back-to-back in the same process, which failed the
// second one with rp_code ["13", "permission denied"], while the exact same
// login alone in a fresh process succeeded. Every session-opening call in
// this app now goes through this queue so logins are always serialized with
// a minimum gap between them, regardless of which feature (sync, connect,
// chart fetch) triggered them — this is what actually stops chart requests
// fired close together (e.g. React re-running an effect twice in dev, or
// switching timeframes quickly) from tripping that same rejection.
let sessionChain: Promise<unknown> = Promise.resolve()
let lastSessionEnd = 0
const MIN_SESSION_GAP_MS = 1500

function queueSession<T>(fn: () => Promise<T>): Promise<T> {
  const run = sessionChain.then(async () => {
    const wait = MIN_SESSION_GAP_MS - (Date.now() - lastSessionEnd)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await fn()
    } finally {
      lastSessionEnd = Date.now()
    }
  })
  // Swallow the error in the chain itself so one failed session doesn't jam
  // the queue for whoever's waiting behind it — callers still see it via `run`.
  sessionChain = run.catch(() => {})
  return run
}

async function withSession<T>(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  work: (ws: WebSocket, root: protobuf.Root) => Promise<T>,
  infraType: number = ORDER_PLANT,
): Promise<T> {
  return queueSession(async () => {
    const root = getRoot()
    const ws = await connect(gatewayUri)

    try {
      ws.send(
        encode(root, "RequestLogin", {
          templateId: 10,
          templateVersion: TEMPLATE_VERSION,
          user,
          password,
          appName: APP_NAME,
          appVersion: APP_VERSION,
          systemName,
          infraType,
        }),
      )
      const loginResp = decode(root, "ResponseLogin", await waitForOne(ws))
      if (!(loginResp.rpCode.length === 1 && loginResp.rpCode[0] === "0")) {
        const [, message] = loginResp.rpCode
        throw new Error(message ? `Rithmic login failed: ${message}` : "Rithmic login failed — check your username and password")
      }

      return await work(ws, root)
    } finally {
      try {
        ws.send(encode(root, "RequestLogout", { templateId: 12 }))
      } catch {
        // best-effort — the socket may already be closing
      }
      ws.close()
    }
  })
}

async function fetchLoginInfo(ws: WebSocket, root: protobuf.Root): Promise<{ fcmId: string; ibId: string; userType: number }> {
  ws.send(encode(root, "RequestLoginInfo", { templateId: 300 }))
  return decode(root, "ResponseLoginInfo", await waitForOne(ws))
}

// user_type enum from the R|Protocol proto (admin=0, fcm=1, ib=2, trader=3).
const USER_TYPE_TRADER = 3

async function listAccountsInSession(ws: WebSocket, root: protobuf.Root, loginInfo?: { fcmId: string; ibId: string; userType: number }): Promise<RithmicAccount[]> {
  loginInfo ??= await fetchLoginInfo(ws, root)

  const requestWith = async (userType: number) => {
    ws.send(
      encode(root, "RequestAccountList", {
        templateId: 302,
        fcmId: loginInfo.fcmId,
        ibId: loginInfo.ibId,
        userType,
      }),
    )
    const { list, terminal } = await collectUntilRpCode(root, ws, "ResponseAccountList")
    const accounts = list
      .filter((a) => a.accountId)
      .map((a) => ({ fcmId: a.fcmId, ibId: a.ibId, accountId: a.accountId, accountName: a.accountName || a.accountId }))
    return { accounts, terminal, raw: list.length }
  }

  let { accounts, terminal, raw } = await requestWith(loginInfo.userType)
  // A login can report a user_type that doesn't return the trader's own
  // accounts (some test/demo logins come back as admin); asking again as a
  // trader is harmless when the first answer already had them.
  if (accounts.length === 0 && loginInfo.userType !== USER_TYPE_TRADER) {
    console.warn(`[rithmic] account list empty for user_type ${loginInfo.userType} (rp_code ${terminal?.rpCode?.join?.(",")}, ${raw} rows); retrying as trader`)
    ;({ accounts, terminal, raw } = await requestWith(USER_TYPE_TRADER))
  }
  if (accounts.length === 0) {
    console.warn(`[rithmic] no accounts returned (fcm ${loginInfo.fcmId}, ib ${loginInfo.ibId}, user_type ${loginInfo.userType}, rp_code ${terminal?.rpCode?.join?.(",")}, ${raw} rows)`)
  }
  return accounts
}

// Rithmic sends absent numeric fields as 0/"" — for a threshold that's
// "not set", not a real zero — so anything non-positive reads as unknown.
function positiveOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

// RMS limits for every account under the login, in one request (template
// 304/305, same order-plant session as the account list).
async function fetchRmsInfoInSession(ws: WebSocket, root: protobuf.Root, loginInfo: { fcmId: string; ibId: string; userType: number }): Promise<Map<string, RithmicAccountRms>> {
  ws.send(encode(root, "RequestAccountRmsInfo", { templateId: 304, fcmId: loginInfo.fcmId, ibId: loginInfo.ibId, userType: loginInfo.userType }))
  const { list } = await collectUntilRpCode(root, ws, "ResponseAccountRmsInfo")
  const byAccount = new Map<string, RithmicAccountRms>()
  for (const r of list) {
    if (!r.accountId) continue
    byAccount.set(r.accountId, {
      accountId: r.accountId,
      algorithm: r.algorithm || null,
      lossLimit: positiveOrNull(r.lossLimit),
      minAccountBalance: positiveOrNull(r.minAccountBalance),
      autoLiquidateThreshold: positiveOrNull(r.autoLiquidateThreshold),
    })
  }
  return byAccount
}

// Collects every message up to and including the one whose template_id is
// `terminalTemplateId`. Rithmic emits a response's messages back to back
// within one tick, so the listener has to be in place before the request
// goes out and stay on until the terminator — a one-shot listener re-armed
// between messages misses the second one (which is how the PnL snapshot's
// 403 terminator was being lost).
function collectUntilTemplate(root: protobuf.Root, ws: WebSocket, terminalTemplateId: number, timeoutMs = 20000): Promise<{ list: WebSocket.RawData[]; terminal: WebSocket.RawData }> {
  const Base = root.lookupType("Base")
  return new Promise((resolve, reject) => {
    const list: WebSocket.RawData[] = []
    const timeout = setTimeout(() => {
      ws.off("message", onMessage)
      reject(new Error(`Timed out waiting for template ${terminalTemplateId}`))
    }, timeoutMs)
    const onMessage = (data: WebSocket.RawData) => {
      const templateId = (Base.decode(data as Buffer) as unknown as { templateId: number }).templateId
      if (templateId === terminalTemplateId) {
        clearTimeout(timeout)
        ws.off("message", onMessage)
        resolve({ list, terminal: data })
      } else {
        list.push(data)
      }
    }
    ws.on("message", onMessage)
  })
}

// Current balance for each account. Lives on the PnL plant, which is a
// separate login from the order plant, so this always opens its own
// session (queued and spaced like every other one). RequestPnLPositionSnapshot
// (402) answers with one AccountPnLPositionUpdate (451) per account plus an
// InstrumentPnLPositionUpdate (450) per open position, then the 403 terminator.
export async function fetchAccountSnapshots(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  accounts: Pick<RithmicAccount, "fcmId" | "ibId" | "accountId">[],
): Promise<Map<string, RithmicAccountSnapshot>> {
  if (accounts.length === 0) return new Map()
  return withSession(
    user,
    password,
    systemName,
    gatewayUri,
    async (ws, root) => {
      const Base = root.lookupType("Base")
      const snapshots = new Map<string, RithmicAccountSnapshot>()
      for (const account of accounts) {
        const collected = collectUntilTemplate(root, ws, 403)
        ws.send(encode(root, "RequestPnLPositionSnapshot", { templateId: 402, fcmId: account.fcmId, ibId: account.ibId, accountId: account.accountId }))
        const { list, terminal } = await collected
        const response = decode(root, "ResponsePnLPositionSnapshot", terminal)
        if (response.rpCode.length > 0 && response.rpCode[0] !== "0" && response.rpCode[0] !== "7") {
          throw new Error(`PnL snapshot request failed: ${response.rpCode.join(", ")}`)
        }
        for (const raw of list) {
          if ((Base.decode(raw as Buffer) as unknown as { templateId: number }).templateId !== 451) continue
          const m = decode(root, "AccountPnLPositionUpdate", raw)
          if (!m.accountId || m.accountBalance == null || m.accountBalance === "") continue
          snapshots.set(m.accountId, {
            accountId: m.accountId,
            accountBalance: Number(m.accountBalance),
            cashOnHand: m.cashOnHand ? Number(m.cashOnHand) : null,
            openPositionPnl: Number(m.openPositionPnl || 0),
            closedPositionPnl: Number(m.closedPositionPnl || 0),
            minAccountBalance: positiveOrNull(m.minAccountBalance),
            at: new Date(),
          })
        }
      }
      return snapshots
    },
    PNL_PLANT,
  )
}

export async function listRithmicAccounts(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
): Promise<RithmicAccount[]> {
  return withSession(user, password, systemName, gatewayUri, (ws, root) => listAccountsInSession(ws, root))
}

// Fetches every fill since `since` for one account and reshapes it into the
// generic ParsedFill shape shared with Tradovate's CSV import, so both feed
// the same reconstructTrades() logic. Does not open its own session — the
// caller must already be inside one (see withSession).
async function fetchFillsInSession(
  ws: WebSocket,
  root: protobuf.Root,
  account: Pick<RithmicAccount, "fcmId" | "ibId" | "accountId">,
  since: Date,
): Promise<ParsedFill[]> {
  const toDateInt = (d: Date) => Number(d.toISOString().slice(0, 10).replace(/-/g, ""))
  const startIndex = toDateInt(since)
  const finishIndex = toDateInt(new Date())

  ws.send(
    encode(root, "RequestShowFillHistory", {
      templateId: 3512,
      fcmId: account.fcmId,
      ibId: account.ibId,
      accountId: account.accountId,
      indexFormat: "trade_date",
      startIndex,
      finishIndex,
      maxRecordCount: 10000,
    }),
  )
  const { list, terminal } = await collectUntilRpCode(root, ws, "ResponseShowFillHistory", 30000)
  // rp_code "7" is Rithmic's "no data" — not an error, just nothing in range.
  if (terminal.rpCode.length > 0 && terminal.rpCode[0] !== "0" && terminal.rpCode[0] !== "7") {
    throw new Error(`Fill history request failed: ${terminal.rpCode.join(", ")}`)
  }

  return list
    .filter((f) => f.symbol && f.fillPrice != null && f.fillSize != null && f.fillTime && f.fillDate)
    .map((f): ParsedFill => ({
      externalId: f.fillId || `${f.symbol}:${f.fillDate}:${f.fillTime}:${f.fillPrice}:${f.fillSize}`,
      account: account.accountId,
      symbol: f.symbol,
      // fill_date is CCYYMMDD, fill_time is HH:MM:SS — both UTC per Rithmic's docs.
      timestamp: `${String(f.fillDate).slice(0, 4)}-${String(f.fillDate).slice(4, 6)}-${String(f.fillDate).slice(6, 8)}T${f.fillTime}Z`,
      action: f.transactionType?.toUpperCase().startsWith("B") ? "Buy" : "Sell",
      qty: Number(f.fillSize),
      price: Number(f.fillPrice),
    }))
}

export async function fetchRithmicFills(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  account: Pick<RithmicAccount, "fcmId" | "ibId" | "accountId">,
  since: Date,
): Promise<ParsedFill[]> {
  return withSession(user, password, systemName, gatewayUri, (ws, root) => fetchFillsInSession(ws, root, account, since))
}

// The periodic sync's order-plant session: fills plus the account's current
// RMS limits, so the liquidation floor follows the trailing drawdown as it
// moves rather than staying at whatever it was on connect.
export async function fetchRithmicFillsAndRms(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  account: Pick<RithmicAccount, "fcmId" | "ibId" | "accountId">,
  since: Date,
): Promise<{ fills: ParsedFill[]; rms: RithmicAccountRms | undefined }> {
  return withSession(user, password, systemName, gatewayUri, async (ws, root) => {
    const fills = await fetchFillsInSession(ws, root, account, since)
    const loginInfo = await fetchLoginInfo(ws, root)
    const rms = await fetchRmsInfoInSession(ws, root, loginInfo).catch(() => new Map<string, RithmicAccountRms>())
    return { fills, rms: rms.get(account.accountId) }
  })
}

// Combined discovery + fill-fetch for the initial connect flow, in ONE
// session. Rithmic (at least this account) rejects a second login attempted
// right after a prior session closes in the same process — confirmed by
// testing listRithmicAccounts followed immediately by fetchRithmicFills,
// which failed on the second login with rp_code ["13", "permission denied"].
// Running both steps inside a single withSession avoids that entirely.
export async function discoverAccountsAndFills(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  since: Date,
): Promise<{ accounts: RithmicAccount[]; fillsByAccountId: Map<string, ParsedFill[]>; rmsByAccountId: Map<string, RithmicAccountRms> }> {
  return withSession(user, password, systemName, gatewayUri, async (ws, root) => {
    const loginInfo = await fetchLoginInfo(ws, root)
    const accounts = await listAccountsInSession(ws, root, loginInfo)
    // Risk limits are informational — a login that can list accounts but
    // not read RMS shouldn't fail the whole connect over it.
    const rmsByAccountId = await fetchRmsInfoInSession(ws, root, loginInfo).catch((err) => {
      console.warn("[rithmic] could not read RMS info:", err instanceof Error ? err.message : err)
      return new Map<string, RithmicAccountRms>()
    })
    const fillsByAccountId = new Map<string, ParsedFill[]>()
    for (const account of accounts) {
      fillsByAccountId.set(account.accountId, await fetchFillsInSession(ws, root, account, since))
    }
    return { accounts, fillsByAccountId, rmsByAccountId }
  })
}

export interface RithmicBar {
  time: number // unix seconds — the bar's "marker" field
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type RithmicBarType = "SECOND_BAR" | "MINUTE_BAR" | "DAILY_BAR"

// RequestTimeBarReplay.BarType enum values, straight from
// request_time_bar_replay.proto (1=SECOND_BAR, 2=MINUTE_BAR, 3=DAILY_BAR,
// 4=WEEKLY_BAR) — hardcoded rather than read via reflection since
// protobufjs's Type object doesn't expose nested enums in a TS-visible way
// (same issue as SysInfraType above).
const BAR_TYPE_VALUES: Record<RithmicBarType, number> = { SECOND_BAR: 1, MINUTE_BAR: 2, DAILY_BAR: 3 }

// Real historical OHLC bars straight from the venue the trade happened on —
// requires logging into the HISTORY_PLANT (a separate infra type from the
// ORDER_PLANT used for account/fill access, so this always opens its own
// session). Template ids 202/203 come from the Reference_Guide.pdf's
// "Templates Specific to History Plant Infrastructure" table, not guessed.
// Confirmed reaching Rithmic's server correctly against the "Rithmic Test"
// sandbox (rp_code "7" / "reference data not available" — that account has
// no market data provisioned, a sandbox-tier limitation, not a request
// error); a live account with a market data subscription is expected to
// return real bars for the same request shape.
export async function fetchTimeBars(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  symbol: string,
  exchange: string,
  barType: RithmicBarType,
  barTypePeriod: number,
  startIndex: number,
  finishIndex: number,
): Promise<RithmicBar[]> {
  return withSession(
    user,
    password,
    systemName,
    gatewayUri,
    async (ws, root) => {
      ws.send(
        encode(root, "RequestTimeBarReplay", {
          templateId: 202,
          symbol,
          exchange,
          barType: BAR_TYPE_VALUES[barType],
          barTypePeriod,
          startIndex,
          finishIndex,
        }),
      )
      const { list, terminal } = await collectUntilRpCode(root, ws, "ResponseTimeBarReplay", 30000)
      // rp_code "7" is Rithmic's "no data" (or, for a sandbox/demo account,
      // "reference data not available") — not a hard error, just nothing to show.
      if (terminal.rpCode.length > 0 && terminal.rpCode[0] !== "0" && terminal.rpCode[0] !== "7") {
        throw new Error(`Time bar request failed: ${terminal.rpCode.join(", ")}`)
      }

      return list
        .filter((b) => b.marker != null && b.openPrice != null && b.highPrice != null && b.lowPrice != null && b.closePrice != null)
        .map((b): RithmicBar => ({
          time: Number(b.marker),
          open: Number(b.openPrice),
          high: Number(b.highPrice),
          low: Number(b.lowPrice),
          close: Number(b.closePrice),
          volume: Number(b.volume ?? 0),
        }))
        .sort((a, b) => a.time - b.time)
    },
    HISTORY_PLANT,
  )
}
