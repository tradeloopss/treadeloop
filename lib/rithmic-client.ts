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
  // ReplayExecutions (3509/3510) is the executions-replay path used when the
  // fill-history request comes back empty; it streams the historical fills as
  // ExchangeOrderNotification (352) messages rather than in the response.
  "request_replay_executions.proto",
  "response_replay_executions.proto",
  "exchange_order_notification.proto",
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

// RequestReplayExecutions (3509) replies not in its own response body but by
// streaming the historical fills as ExchangeOrderNotification (352) messages,
// then a ResponseReplayExecutions (3510) with rp_code to mark the end. A fill
// is an ExchangeOrderNotification whose notify_type is FILL (5); its side is
// the numeric TransactionType enum (BUY=1). All four come straight from the
// SDK's exchange_order_notification.proto / the Reference_Guide template table.
const EXCHANGE_ORDER_NOTIFICATION_TEMPLATE = 352
const REPLAY_EXECUTIONS_RESPONSE_TEMPLATE = 3510
const NOTIFY_TYPE_FILL = 5
const TRANSACTION_TYPE_BUY = 1

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

// Collects a fill-history response. Unlike the generic list collector, a
// message is treated as a fill whenever it carries a symbol — including the
// terminating message (Rithmic marks the last part of a response with
// rp_code, and a single-fill response can carry its one fill on that same
// message, which the generic collector would discard).
function collectFills(root: protobuf.Root, ws: WebSocket, timeoutMs = 12000): Promise<{ fills: any[]; terminal: any }> {
  return new Promise((resolve, reject) => {
    const fills: any[] = []
    const timeout = setTimeout(() => {
      ws.off("message", onMessage)
      reject(new Error("Timed out waiting for ResponseShowFillHistory"))
    }, timeoutMs)
    const onMessage = (data: WebSocket.RawData) => {
      const msg = decode(root, "ResponseShowFillHistory", data)
      if (msg.symbol) fills.push(msg)
      if (msg.rpCode && msg.rpCode.length > 0) {
        clearTimeout(timeout)
        ws.off("message", onMessage)
        resolve({ fills, terminal: msg })
      }
    }
    ws.on("message", onMessage)
  })
}

// Collects a ReplayExecutions stream. The fills arrive as ExchangeOrderNotification
// (352) messages — dispatched by template_id off the Base header, since several
// message types share the socket — and ResponseReplayExecutions (3510) is the
// terminator carrying rp_code. Only FILL notifications with a price and size are
// kept; order-status chatter for the same orders is ignored.
//
// The connect flow runs on a 60s budget, so this must never sit on a fixed
// long timeout: it resolves the instant the terminator arrives, and otherwise
// on quiet — a short wait if nothing ever comes (the terminator isn't sent, or
// the account simply has no executions), extended each time a message does, so
// a long run of fills is followed to its end while an unanswered request gives
// up fast. Resolving (never rejecting) means a missing terminator can't discard
// fills that already streamed in.
const REPLAY_FIRST_MSG_MS = 6000
const REPLAY_IDLE_MS = 3000
const REPLAY_HARD_CAP_MS = 12000
function collectExecutions(root: protobuf.Root, ws: WebSocket): Promise<{ fills: any[]; terminal: any | null }> {
  const Base = root.lookupType("Base")
  return new Promise((resolve) => {
    const fills: any[] = []
    let idle: ReturnType<typeof setTimeout>
    const finish = (terminal: any | null) => {
      clearTimeout(hardCap)
      clearTimeout(idle)
      ws.off("message", onMessage)
      resolve({ fills, terminal })
    }
    const bumpIdle = (ms: number) => {
      clearTimeout(idle)
      idle = setTimeout(() => finish(null), ms)
    }
    const hardCap = setTimeout(() => finish(null), REPLAY_HARD_CAP_MS)
    bumpIdle(REPLAY_FIRST_MSG_MS)
    const onMessage = (data: WebSocket.RawData) => {
      const templateId = (Base.decode(data as Buffer) as unknown as { templateId: number }).templateId
      if (templateId === EXCHANGE_ORDER_NOTIFICATION_TEMPLATE) {
        const msg = decode(root, "ExchangeOrderNotification", data)
        // A real fill carries a price and size; order-status chatter doesn't.
        // notify_type isn't always populated on a replayed row, so it only has
        // to NOT be some other (non-fill) notification, rather than == FILL.
        if (msg.fillPrice != null && msg.fillSize != null && (msg.notifyType == null || msg.notifyType === NOTIFY_TYPE_FILL)) fills.push(msg)
        bumpIdle(REPLAY_IDLE_MS)
      } else if (templateId === REPLAY_EXECUTIONS_RESPONSE_TEMPLATE) {
        finish(decode(root, "ResponseReplayExecutions", data))
      } else {
        // An unrelated message on the socket still means it's alive — keep
        // waiting a little, but don't let stray traffic hold the hard cap.
        bumpIdle(REPLAY_IDLE_MS)
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
  // The account's total commission and total filled contracts as Rithmic's RMS
  // tracks them — the fill feed carries no commission, so this snapshot is the
  // only place we can get it. Dividing gives an average per-contract commission
  // used to make synced P&L net (lib/rithmic-sync.ts). Null when not reported.
  commission: number | null
  filledContracts: number | null
  at: Date
}

function openSocket(uri: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    // handshakeTimeout bounds the TLS/HTTP upgrade; the outer timer covers a
    // socket that connects but then stalls before "open". Kept fairly tight so
    // a throttled handshake (Rithmic rate-limits cloud IPs, which shows up as
    // "Opening handshake has timed out") fails fast and is retried by connect()
    // rather than burning the whole request budget on one dead attempt.
    const ws = new WebSocket(uri, { rejectUnauthorized: false, handshakeTimeout: 8000 })
    const cleanup = () => {
      clearTimeout(timer)
      ws.off("open", onOpen)
      ws.off("error", onError)
      ws.off("close", onClose)
    }
    const onOpen = () => {
      cleanup()
      resolve(ws)
    }
    const onError = (err: Error) => {
      cleanup()
      try {
        ws.terminate()
      } catch {
        // already closing
      }
      reject(err)
    }
    const onClose = () => {
      cleanup()
      reject(new Error("Rithmic closed the connection before it was ready"))
    }
    const timer = setTimeout(() => {
      cleanup()
      try {
        ws.terminate()
      } catch {
        // already closing
      }
      reject(new Error("Timed out connecting to the Rithmic gateway"))
    }, 15000)
    ws.once("open", onOpen)
    ws.once("error", onError)
    ws.once("close", onClose)
  })
}

// The connection to a Rithmic gateway from a cloud host can drop during the
// TLS handshake (a reset, a socket hang up) or have the handshake throttled
// outright ("Opening handshake has timed out" — Rithmic rate-limits cloud IPs)
// transiently, so a failed connect is retried several times with a short
// backoff before giving up. That handshake-timeout case is the main thing the
// background auto-sync trips on, and it usually clears within a retry or two.
// A bad address fails the same way every time and just exhausts the attempts.
async function connect(uri: string, attempts = 3): Promise<WebSocket> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await openSocket(uri)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      const transient = /TLS|ECONNRESET|socket disconnected|socket hang ?up|ETIMEDOUT|EAI_AGAIN|before secure|closed the connection before|handshake|timed out|timeout/i.test(message)
      if (!transient || attempt === attempts) break
      console.warn(`[rithmic] connect attempt ${attempt} to ${uri} failed (${message}); retrying`)
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
  throw lastError
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

// Opens a socket and logs it in, returning the live socket — retrying the
// whole connect+login as a unit, because from a cloud host every step of it
// is flaky: the TLS handshake gets throttled ("Opening handshake has timed
// out"), the login reply can be slow to arrive ("Timed out waiting for Rithmic
// response"), and — since Rithmic allows one session per login — a login racing
// a background auto-sync for the same account is refused with rp_code ["13",
// "permission denied"]. All three clear on a retry within a second or two, so
// this rides them out under a wall-clock budget rather than surfacing the first
// blip. Only a real dead end stops it early: bad credentials / no API access
// (a login refusal that isn't the concurrency one), which no retry can fix.
const LOGIN_RESPONSE_TIMEOUT_MS = 8000
const SESSION_OPEN_BUDGET_MS = 14000
async function openLoggedInSession(
  root: protobuf.Root,
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  infraType: number,
): Promise<WebSocket> {
  const deadline = Date.now() + SESSION_OPEN_BUDGET_MS
  let attempt = 0
  let lastError: unknown
  while (Date.now() < deadline) {
    attempt++
    let ws: WebSocket | undefined
    try {
      // openSocket, not connect(): the retry lives here now, so there's a
      // single retry layer over the whole handshake+login rather than two
      // nested ones that could together outrun the request budget.
      ws = await openSocket(gatewayUri)
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
      const loginResp = decode(root, "ResponseLogin", await waitForOne(ws, LOGIN_RESPONSE_TIMEOUT_MS))
      if (loginResp.rpCode.length === 1 && loginResp.rpCode[0] === "0") return ws

      const [code, message] = loginResp.rpCode
      closeQuietly(root, ws)
      ws = undefined
      const concurrent = code === "13" || /permission denied/i.test(message ?? "")
      if (!concurrent) {
        // A non-concurrency refusal is bad credentials or an account without
        // API access — retrying can't help, so surface it immediately.
        throw new Error(message ? `Rithmic login failed: ${message}` : "Rithmic login failed — check your username and password")
      }
      lastError = new Error(`Rithmic login failed: ${message ?? "permission denied"}`)
      console.warn(`[rithmic] login attempt ${attempt} refused (${code} ${message}) — another session may hold this login; retrying`)
    } catch (err) {
      if (ws) closeQuietly(root, ws)
      // A hard auth failure thrown just above must not be retried.
      if (err instanceof Error && /login failed/i.test(err.message) && !/permission denied/i.test(err.message)) throw err
      const message = err instanceof Error ? err.message : String(err)
      const transient = /handshake|timed out|timeout|TLS|ECONNRESET|socket|closed the connection|before secure|EAI_AGAIN|ETIMEDOUT/i.test(message)
      if (!transient) throw err
      lastError = err
      console.warn(`[rithmic] session open attempt ${attempt} failed (${message}); retrying`)
    }
    const backoff = Math.min(1200 * attempt, 3000)
    if (Date.now() + backoff >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }
  throw lastError ?? new Error("Timed out connecting to Rithmic")
}

// Best-effort logout + close for a socket we're abandoning.
function closeQuietly(root: protobuf.Root, ws: WebSocket): void {
  try {
    ws.send(encode(root, "RequestLogout", { templateId: 12 }))
  } catch {
    // the socket may already be closing
  }
  try {
    ws.close()
  } catch {
    // already closed
  }
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
    const ws = await openLoggedInSession(root, user, password, systemName, gatewayUri, infraType)

    try {
      return await work(ws, root)
    } finally {
      closeQuietly(root, ws)
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
            commission: m.rmsAccountCommission != null && m.rmsAccountCommission !== "" ? Math.abs(Number(m.rmsAccountCommission)) : null,
            filledContracts: (Number(m.fillBuyQty || 0) + Number(m.fillSellQty || 0)) || null,
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
// Reshapes one raw Rithmic fill row into the shared ParsedFill, reading the
// price/size/time across the several fields Rithmic may populate, and adds it
// to the dedupe map. Skips a row that carries no usable price, size, or time.
function addParsedFill(byId: Map<string, ParsedFill>, accountId: string, f: any): void {
  // Fill history, like the replay stream, can return rows for EVERY account
  // under the login — each row carries its own account_id, so drop any that
  // isn't this account, or one account shows another's trades.
  if (f.accountId != null && f.accountId !== "" && String(f.accountId) !== String(accountId)) return
  const price = f.fillPrice ?? f.avgFillPrice ?? f.price
  const size = f.fillSize ?? f.totalFillSize
  const timestamp =
    f.fillDate && f.fillTime
      ? `${String(f.fillDate).slice(0, 4)}-${String(f.fillDate).slice(4, 6)}-${String(f.fillDate).slice(6, 8)}T${f.fillTime}Z`
      : f.ssboe != null
        ? new Date(Number(f.ssboe) * 1000).toISOString()
        : null
  if (!(f.symbol && price != null && size != null && Number(size) > 0 && timestamp)) return
  const externalId = f.fillId || `${f.symbol}:${timestamp}:${price}:${size}`
  byId.set(externalId, {
    externalId,
    account: accountId,
    symbol: f.symbol,
    timestamp,
    action: f.transactionType?.toUpperCase().startsWith("B") ? "Buy" : "Sell",
    qty: Number(size),
    price: Number(price),
  })
}

// Reshapes one ExchangeOrderNotification FILL (from a ReplayExecutions stream)
// into the shared ParsedFill. Unlike a fill-history row, its transaction_type
// is the numeric TransactionType enum (BUY=1) and its time is ssboe/usecs
// (seconds+microseconds since epoch), not fill_date/fill_time strings.
function addExecutionFill(byId: Map<string, ParsedFill>, accountId: string, m: any): void {
  // A replay streams executions for EVERY account under the login, and each
  // fill carries its own account_id — so keep only this account's, or one
  // account ends up showing another account's trades.
  if (m.accountId != null && m.accountId !== "" && String(m.accountId) !== String(accountId)) return
  const price = m.fillPrice ?? m.avgFillPrice
  const size = m.fillSize ?? m.totalFillSize
  if (!(m.symbol && price != null && size != null && Number(size) > 0 && m.ssboe != null)) return
  const timestamp = new Date(Number(m.ssboe) * 1000 + Math.floor(Number(m.usecs || 0) / 1000)).toISOString()
  // exchange_order_id can repeat across an order's partial fills, so the id
  // also carries the time and price to stay unique per execution.
  const externalId = `${m.exchangeOrderId || m.symbol}:${m.ssboe}:${m.usecs || 0}:${price}:${size}`
  byId.set(externalId, {
    externalId,
    account: accountId,
    symbol: m.symbol,
    timestamp,
    action: m.transactionType === TRANSACTION_TYPE_BUY ? "Buy" : "Sell",
    qty: Number(size),
    price: Number(price),
  })
}

// Pulls fills via RequestReplayExecutions (3509) — the executions-replay path,
// which streams historical fills as ExchangeOrderNotification messages. This is
// a different endpoint than RequestShowFillHistory, and returns data for
// accounts whose fill-history request comes back empty. start/finish_index are
// seconds-since-epoch (ssboe); the range is capped to MAX_FILL_LOOKBACK_MS.
async function fetchExecutionsInSession(
  ws: WebSocket,
  root: protobuf.Root,
  account: Pick<RithmicAccount, "fcmId" | "ibId" | "accountId">,
  since: Date,
): Promise<ParsedFill[]> {
  const today = new Date()
  const start = new Date(Math.max(since.getTime(), today.getTime() - MAX_FILL_LOOKBACK_MS))
  const startIndex = Math.floor(start.getTime() / 1000)
  const finishIndex = Math.floor(today.getTime() / 1000)

  const request = async (fields: Record<string, unknown>) => {
    const collected = collectExecutions(root, ws)
    ws.send(encode(root, "RequestReplayExecutions", { templateId: 3509, fcmId: account.fcmId, ibId: account.ibId, accountId: account.accountId, ...fields }))
    const { fills, terminal } = await collected
    const rp: string[] = terminal?.rpCode ?? []
    if (rp.length > 0 && rp[0] !== "0" && rp[0] !== "7") {
      throw new Error(`Replay executions request failed: ${rp.join(", ")}`)
    }
    return { fills, rp, terminal }
  }

  let { fills, rp, terminal } = await request({ startIndex, finishIndex })
  // If the seconds-since-epoch range came back empty, some deployments answer
  // an unfiltered replay (no indices) with the account's whole execution
  // history — the same "bounded range is empty, unfiltered isn't" quirk the
  // fill-history path hits. Only worth a second request when Rithmic actually
  // answered the first (a terminal arrived): a null terminal means the request
  // timed out — the connection is throttled, so a retry just times out again.
  if (fills.length === 0 && terminal) {
    const alt = await request({})
    if (alt.fills.length > 0) ({ fills, rp, terminal } = alt)
  }

  // A replay streams executions for EVERY account under the login. Whenever the
  // fills carry an account id at all, keep ONLY the ones whose id matches this
  // account — so foreign accounts' trades can never leak in (that's "trades I
  // didn't take"). Only when NO fill carries an account id do we fall back to
  // trusting the request's own account scoping.
  const mine = String(account.accountId)
  const seenAccts = new Set<string>()
  for (const m of fills) if (m.accountId != null && m.accountId !== "") seenAccts.add(String(m.accountId))
  const mustFilter = seenAccts.size > 0

  const byId = new Map<string, ParsedFill>()
  let otherAccount = 0
  let buys = 0
  let sells = 0
  const symbols = new Set<string>()
  for (const m of fills) {
    const fillAcct = m.accountId != null && m.accountId !== "" ? String(m.accountId) : ""
    if (mustFilter && fillAcct !== mine) {
      otherAccount++
      continue
    }
    if (m.transactionType === TRANSACTION_TYPE_BUY) buys++
    else sells++
    if (m.symbol) symbols.add(String(m.symbol))
    addExecutionFill(byId, account.accountId, m)
  }
  const diag = `${mine}: replay ${fills.length} exec, accts=[${[...seenAccts].join(",") || "none"}], ${otherAccount} other, ${buys}B/${sells}S, sym=${[...symbols].join("/") || "none"}→${byId.size} kept, rp=${rp.join(",") || (terminal ? "none" : "timeout")}, from ${startIndex}`
  console.log(`[rithmic] ${diag}`)
  rithmicFillDiagnostics.push(diag)
  return [...byId.values()]
}

const DAY_MS = 24 * 60 * 60 * 1000
// Rithmic answers a fill-history request over a bounded trade-date range, and
// a single very wide range (e.g. since the epoch) comes back empty. So the
// history is pulled in ~90-day windows, and a connect's "everything" is
// capped at two years back — long enough for any prop-firm account's life,
// short enough to stay within the login's time budget.
const FILL_WINDOW_DAYS = 90
const MAX_FILL_LOOKBACK_MS = 730 * DAY_MS
// Wall-clock ceiling for the windowed fill-history pull, so a throttled or
// merely-slow connection can't stretch it across many windows into minutes.
const FILL_HISTORY_BUDGET_MS = 25000

async function fetchFillsInSession(
  ws: WebSocket,
  root: protobuf.Root,
  account: Pick<RithmicAccount, "fcmId" | "ibId" | "accountId">,
  since: Date,
): Promise<ParsedFill[]> {
  // Prefer the executions-replay endpoint: for accounts whose fill-history
  // request returns "no data", it's the path that actually carries the trades.
  // The fill-history windows below stay as a fallback for setups where replay
  // is the empty one. A replay error (not just "no data") shouldn't sink the
  // whole sync, so it falls through to the history request too.
  try {
    const replay = await fetchExecutionsInSession(ws, root, account, since)
    if (replay.length > 0) return replay
  } catch (err) {
    console.warn(`[rithmic] replay executions failed for ${account.accountId}, falling back to fill history:`, err instanceof Error ? err.message : err)
  }

  const toDateInt = (d: Date) => Number(d.toISOString().slice(0, 10).replace(/-/g, ""))
  const today = new Date()
  const start = new Date(Math.max(since.getTime(), today.getTime() - MAX_FILL_LOOKBACK_MS))

  const byId = new Map<string, ParsedFill>()
  let windows = 0
  let raw = 0
  let lastRp: string[] = ["0"]
  // Track the account ids the fill rows carry (and how many belong to a
  // different account) so the diagnostic shows whether foreign trades were
  // filtered out. addParsedFill drops the foreign ones; this only counts them.
  const fhAccts = new Set<string>()
  let fhOther = 0
  const addFills = (rows: any[]) => {
    for (const f of rows) {
      if (f.accountId != null && f.accountId !== "") {
        fhAccts.add(String(f.accountId))
        if (String(f.accountId) !== String(account.accountId)) fhOther++
      }
      addParsedFill(byId, account.accountId, f)
    }
  }
  // A hard ceiling on the whole windowed pull. A single hung request already
  // aborts (collectFills rejects on timeout), but under mild throttle every
  // window can answer slowly-but-not-quite-timing-out, and 9 windows × two
  // index formats of that would still run for minutes — so once the budget is
  // spent, stop with whatever's in hand rather than dragging the sync out.
  const fetchDeadline = Date.now() + FILL_HISTORY_BUDGET_MS
  const requestWindow = async (indexFormat: "trade_date" | "ssboe", startIndex: number, finishIndex: number) => {
    ws.send(
      encode(root, "RequestShowFillHistory", {
        templateId: 3512,
        fcmId: account.fcmId,
        ibId: account.ibId,
        accountId: account.accountId,
        indexFormat,
        startIndex,
        finishIndex,
        maxRecordCount: 10000,
      }),
    )
    const { fills, terminal } = await collectFills(root, ws, 12000)
    const rp = terminal.rpCode ?? []
    if (rp.length > 0 && rp[0] !== "0" && rp[0] !== "7") {
      throw new Error(`Fill history request failed: ${rp.join(", ")}`)
    }
    return { fills, rp }
  }

  for (let winStart = new Date(start); winStart.getTime() <= today.getTime(); winStart = new Date(winStart.getTime() + FILL_WINDOW_DAYS * DAY_MS)) {
    if (Date.now() > fetchDeadline) {
      console.warn(`[rithmic] fill-history budget spent for ${account.accountId} after ${windows} window(s); stopping`)
      break
    }
    const winEnd = new Date(Math.min(winStart.getTime() + (FILL_WINDOW_DAYS - 1) * DAY_MS, today.getTime()))
    windows++
    let { fills, rp } = await requestWindow("trade_date", toDateInt(winStart), toDateInt(winEnd))
    // Some Rithmic deployments honour only the seconds-since-epoch index — so
    // if trade_date came back empty, try the same window as ssboe.
    if (fills.length === 0) {
      const ssStart = Math.floor(winStart.getTime() / 1000)
      const ssEnd = Math.floor((winEnd.getTime() + DAY_MS - 1) / 1000)
      const alt = await requestWindow("ssboe", ssStart, ssEnd)
      if (alt.fills.length > 0) {
        fills = alt.fills
        rp = alt.rp
      }
    }
    lastRp = rp
    raw += fills.length
    addFills(fills)
  }

  // Last resort: some Rithmic setups return "no data" for any bounded range
  // but answer an unfiltered request (no index/dates) with everything. Only
  // tried when the windowed pulls all came back empty.
  if (byId.size === 0) {
    windows++
    ws.send(encode(root, "RequestShowFillHistory", { templateId: 3512, fcmId: account.fcmId, ibId: account.ibId, accountId: account.accountId, maxRecordCount: 10000 }))
    const { fills, terminal } = await collectFills(root, ws, 12000)
    const rp = terminal.rpCode ?? []
    if (!(rp.length > 0 && rp[0] !== "0" && rp[0] !== "7")) {
      lastRp = rp
      raw += fills.length
      addFills(fills)
    }
  }

  const diag = `${account.accountId}: fillhist ${raw} rows, accts=[${[...fhAccts].join(",") || "none"}], ${fhOther} other→${byId.size} kept, rp=${lastRp.join(",") || "none"}, fcm=${account.fcmId ? "y" : "n"}, ib=${account.ibId ? "y" : "n"}, ${windows}w from ${toDateInt(start)}`
  console.log(`[rithmic] ${diag}`)
  rithmicFillDiagnostics.push(diag)
  return [...byId.values()]
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
// A short, human-readable trail of what the last fill-history fetch actually
// got from Rithmic (row counts, rp_code, whether fcm/ib were present) — read
// once by the connect action so the trader can report it when history is
// empty and there are no server logs to hand.
let rithmicFillDiagnostics: string[] = []
export function takeRithmicFillDiagnostics(): string[] {
  const d = rithmicFillDiagnostics
  rithmicFillDiagnostics = []
  return d
}

export async function discoverAccountsAndFills(
  user: string,
  password: string,
  systemName: string,
  gatewayUri: string,
  since: Date,
): Promise<{ accounts: RithmicAccount[]; fillsByAccountId: Map<string, ParsedFill[]>; rmsByAccountId: Map<string, RithmicAccountRms> }> {
  rithmicFillDiagnostics = []
  return withSession(user, password, systemName, gatewayUri, async (ws, root) => {
    const loginInfo = await fetchLoginInfo(ws, root)
    console.log(`[rithmic] loginInfo fcm=${loginInfo.fcmId || "(empty)"} ib=${loginInfo.ibId || "(empty)"} userType=${loginInfo.userType}`)
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
