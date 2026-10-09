import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addonSource, ADDON_VERSION } from "@/lib/ninjatrader/addon-source"
import { parsePayload } from "@/lib/ninjatrader/payload"
import { accountTypeOf, parseProvisionLine, provisionLine } from "@/lib/ninjatrader/provision-lines"

// Compiles the add-on NinjaTrader would compile (with the C# 5 compiler, the
// oldest NinjaTrader 8 supports) against stand-ins of NinjaScript's types,
// runs a short simulated session, and checks every request it makes against
// the server's own parser. Needs Windows' csc.exe; skipped elsewhere.

const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
const KEY = "tlnt_" + "k".repeat(43)

test("source: key, URL and version are filled in; nothing else can be injected", () => {
  const src = addonSource({ key: KEY, syncUrl: "https://www.tradeloop.pro/api/ninjatrader/sync" })
  assert.ok(src.includes(`private const string SyncKey = "${KEY}";`))
  assert.ok(src.includes(`private const string SyncUrl = "https://www.tradeloop.pro/api/ninjatrader/sync";`))
  assert.ok(src.includes(`private const string Version = "${ADDON_VERSION}";`))
  assert.ok(!src.includes("__TRADELOOP_"), "no placeholder left")
  assert.ok(!/\r(?!\n)/.test(src) && src.includes("\r\n"), "CRLF line endings for Windows editors")
  assert.throws(() => addonSource({ key: 'tlnt_x"; evil', syncUrl: "https://x.example/y" }))
  assert.throws(() => addonSource({ key: KEY, syncUrl: 'https://x.example/"+evil' }))
  // Read-only: no order entry anywhere.
  assert.doesNotMatch(src, /\.(Submit|CreateOrder|Cancel|CancelAllOrders|Flatten|Change)\(/)
  // What a trader downloads is the sync add-on alone: nothing in it connects a login or knows of a password.
  assert.doesNotMatch(src, /Provision|Password|Connection\.Connect|TradovateOptions/)
})

const PROVISION = { url: "http://127.0.0.1:9210", token: "p".repeat(40) }

test("the server's copy: the same add-on, and one that keeps traders' logins connected, asking only this machine", () => {
  const pc = addonSource({ key: KEY, syncUrl: "https://www.tradeloop.pro/api/ninjatrader/relay" })
  const src = addonSource({ key: KEY, syncUrl: "https://www.tradeloop.pro/api/ninjatrader/relay", provision: PROVISION })
  assert.ok(src.startsWith(pc), "the sync add-on is in it unchanged")
  assert.ok(src.includes("public class TradeLoopProvision : AddOnBase"))
  assert.ok(src.includes(`private const string ProvisionUrl = "http://127.0.0.1:9210";`))
  assert.ok(src.includes(`private const string ProvisionToken = "${PROVISION.token}";`))
  assert.ok(!src.includes("__TRADELOOP_"), "no placeholder left")
  assert.ok(!/\r(?!\n)/.test(src) && !/[^\r]\n/.test(src), "CRLF throughout")
  // still no order entry: it connects and disconnects, nothing else
  assert.doesNotMatch(src, /\.(Submit|CreateOrder|Cancel|CancelAllOrders|Flatten|Change)\(/)
  // a login goes into the connection it makes and nowhere else: never to a file, the saved connections or the Output window
  const provision = src.slice(pc.length)
  assert.doesNotMatch(provision, /File\.|StreamWriter|Globals\.ConnectOptions|ConnectOptions\.Add/)
  for (const note of provision.match(/Note\([^;]*\);/g) ?? []) assert.doesNotMatch(note, /Password|\.User\b/, note)
  assert.match(provision, /options\.ConnectOnStartup = false;/)
  // the worker is this machine, or the file isn't made
  for (const url of ["http://10.0.0.5:9210", "https://127.0.0.1:9210", "http://127.0.0.1:9210/x", "http://localhost:9210", 'http://127.0.0.1:9210"; evil']) assert.throws(() => addonSource({ key: KEY, syncUrl: "https://x.example/y", provision: { ...PROVISION, url } }), url)
  assert.throws(() => addonSource({ key: KEY, syncUrl: "https://x.example/y", provision: { ...PROVISION, token: 'short"' } }))
})

test("a login as the worker hands it over: one line, whatever the trader typed", () => {
  const login = { id: 7, name: "tl-7", kind: "Apex", username: 'apex\tuser "x"', password: 'p"a\tss\nword\\ é', status: "provisioning" }
  const line = provisionLine(login)
  assert.equal(line.split("\t").length, 6)
  assert.doesNotMatch(line, /[\r\n]/)
  assert.ok(!line.includes(login.password) && !line.includes("p\"a"))
  assert.deepEqual(parseProvisionLine(line), { id: 7, name: "tl-7", accountType: "simulation", username: login.username, password: login.password, status: "provisioning" })
  // a prop firm's accounts are on Tradovate's simulation side; an account with Tradovate itself is live
  assert.deepEqual(["Tradovate", " tradovate ", "Apex", "Tradeify", "MyFundedFutures", "TakeProfitTrader", "BluSky", "Something new"].map(accountTypeOf), ["live", "live", "simulation", "simulation", "simulation", "simulation", "simulation", "simulation"])
  assert.equal(parseProvisionLine("not a line"), null)
})

test("compiles as C# 5 and posts what the server accepts", { skip: !existsSync(CSC) && "csc.exe not available" }, async () => {
  const bodies: { auth: string | undefined; body: unknown }[] = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      bodies.push({ auth: req.headers.authorization, body: JSON.parse(raw) })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const port = (server.address() as { port: number }).port
  try {
    const dir = mkdtempSync(join(tmpdir(), "tl-nt-"))
    const here = new URL(".", import.meta.url)
    writeFileSync(join(dir, "TradeLoopSync.cs"), addonSource({ key: KEY, syncUrl: `http://127.0.0.1:${port}/api/ninjatrader/sync` }))
    writeFileSync(join(dir, "stubs.cs"), readFileSync(new URL("stubs.cs", here)))
    writeFileSync(join(dir, "harness.cs"), readFileSync(new URL("harness.cs", here)))
    const csc = (args: string[]) => execFileSync(CSC, ["/nologo", "/warnaserror-", ...args], { cwd: dir, encoding: "utf8" })
    csc(["/t:library", "/out:NinjaTrader.Stubs.dll", "stubs.cs"])
    const out = csc(["/t:exe", "/out:harness.exe", "/r:NinjaTrader.Stubs.dll", "TradeLoopSync.cs", "harness.cs"])
    assert.ok(!/error CS/.test(out), out)

    const log = await new Promise<string>((resolve, reject) => {
      const child = spawn(join(dir, "harness.exe"), [], { cwd: dir })
      let text = ""
      child.stdout.on("data", (c) => (text += c))
      child.stderr.on("data", (c) => (text += c))
      child.on("error", reject)
      child.on("exit", () => resolve(text))
    })
    assert.match(log, /\[TradeLoop\] TradeLoop Sync 1\.\d+\.\d+ is running\./)
    assert.match(log, /harness done/)

    assert.equal(bodies.length, 3, `requests: ${JSON.stringify(bodies, null, 1)}\n${log}`)
    for (const b of bodies) assert.equal(b.auth, `Bearer ${KEY}`)
    const parsed = bodies.map((b) => {
      const r = parsePayload(b.body, new Date("2025-11-03T20:00:00Z"))
      assert.ok(r.ok, JSON.stringify(r))
      return r.value
    })

    // 1: the session on start — the prop account only (Sim101 is local simulation).
    assert.deepEqual(parsed[0].accounts.map((a) => [a.name, a.provider, a.connection, a.cashValue]), [["APEX-123456-01", "NinjaTrader", 'Apex "Tradovate"', 50600.5]])
    assert.equal(parsed[0].rejected.length, 0)
    const e1 = parsed[0].executions[0]
    assert.deepEqual(
      [e1.providerAccountId, e1.providerExecutionId, e1.symbol, e1.contractMonth, e1.side, e1.quantity, e1.price, e1.pointValue, e1.commission, e1.timestamp.toISOString()],
      ["APEX-123456-01", "APEX-123456-01|E1", "ESZ5", "2025-12", "buy", 2, 6500, 50, 4.1, "2025-11-03T14:30:00.120Z"],
    )
    assert.equal(parsed[0].client.version, ADDON_VERSION)
    // 2: the live fill, within seconds.
    assert.deepEqual(parsed[1].executions.map((e) => [e.providerExecutionId, e.side, e.price]), [["APEX-123456-01|E2", "sell", 6505.25]])
    // 3: an account that connected later, with its session.
    assert.deepEqual(parsed[2].accounts.map((a) => a.name), ["APEX-123456-01", "TPT-9"])
    assert.deepEqual(parsed[2].executions.map((e) => e.providerExecutionId), ["TPT-9|E3"])

    // Orders and positions are captured too (Phase 2), and the local-sim account's are skipped.
    const allOrders = parsed.flatMap((p) => p.orders)
    const o1 = allOrders.find((o) => o.providerOrderId === "O-E1")
    assert.ok(o1, `order O-E1 captured: ${JSON.stringify(allOrders)}`)
    assert.deepEqual([o1!.side, o1!.status, o1!.symbol, o1!.orderType], ["buy", "filled", "ESZ5", "limit"])
    const o2 = allOrders.find((o) => o.providerOrderId === "O-E2")
    assert.ok(o2 && o2.side === "sell" && o2.orderType === "stop", "the stop order was captured and classified by type")
    assert.ok(!allOrders.some((o) => o.providerAccountId === "Sim101"), "the local-sim account's order is skipped, like its fills")
    const allPositions = parsed.flatMap((p) => p.positions)
    assert.ok(allPositions.some((p) => p.providerAccountId === "APEX-123456-01" && p.symbol === "ESZ5" && p.netQuantity === 2), "the long position was captured")
    assert.ok(allPositions.some((p) => p.netQuantity === 0), "the position going flat was captured (so the server can clear it)")
  } finally {
    server.close()
  }
})

test("TradeLoop Provision: connects what traders entered, reports what Tradovate said, and leaves everything else alone", { skip: !existsSync(CSC) && "csc.exe not available" }, async () => {
  // The worker, as the add-on sees it. The list of logins changes as the session goes on.
  type L = { id: number; name: string; kind: string; username: string; password: string; status: string }
  const apex = (password: string): L => ({ id: 1, name: "tl-1", kind: "Apex", username: "apex user", password, status: "connected" })
  const direct = (password: string, status: string): L => ({ id: 2, name: "tl-2", kind: "Tradovate", username: "direct", password, status })
  const waiting: L = { id: 3, name: "tl-3", kind: "Tradeify", username: "refused before", password: "wrong", status: "reauth" }
  const notOurs: L = { id: 4, name: "other-4", kind: "Apex", username: "x", password: "y", status: "pending" }
  const blank: L = { id: 5, name: "tl-5", kind: "Apex", username: "cleared", password: "", status: "pending" }
  let logins: L[] = [apex('p"a\tss'), direct("wrong", "pending"), waiting, notOurs, blank]
  const reports: { id: number; status: string; message?: string }[] = []
  let polls = 0
  let unauthorized = 0
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${PROVISION.token}`) {
      unauthorized++
      res.writeHead(401)
      return res.end()
    }
    if (req.method === "GET" && req.url === "/provision?format=lines") {
      polls++
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
      return res.end(logins.map(provisionLine).join("\n"))
    }
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const body = JSON.parse(raw)
      reports.push(body)
      // what the real worker does with a refusal: the login waits for the trader
      if (body.status === "reauth") logins = logins.map((l) => (l.id === body.id ? { ...l, status: "reauth" } : l))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const port = (server.address() as { port: number }).port
  try {
    const dir = mkdtempSync(join(tmpdir(), "tl-ntp-"))
    const here = new URL(".", import.meta.url)
    writeFileSync(join(dir, "TradeLoopRelay.cs"), addonSource({ key: KEY, syncUrl: `http://127.0.0.1:${port}/api/ninjatrader/relay`, provision: { url: `http://127.0.0.1:${port}`, token: PROVISION.token } }))
    writeFileSync(join(dir, "stubs.cs"), readFileSync(new URL("stubs.cs", here)))
    writeFileSync(join(dir, "provision-harness.cs"), readFileSync(new URL("provision-harness.cs", here)))
    const csc = (args: string[]) => execFileSync(CSC, ["/nologo", "/warnaserror-", ...args], { cwd: dir, encoding: "utf8" })
    csc(["/t:library", "/out:NinjaTrader.Stubs.dll", "stubs.cs"])
    const out = csc(["/t:exe", "/out:provision.exe", "/r:NinjaTrader.Stubs.dll", "TradeLoopRelay.cs", "provision-harness.cs"])
    assert.ok(!/error CS/.test(out), out)

    const until = async (what: string, ok: () => boolean) => {
      for (let i = 0; i < 150 && !ok(); i++) await new Promise((r) => setTimeout(r, 100))
      assert.ok(ok(), `${what}\nreports: ${JSON.stringify(reports)}`)
    }
    let text = ""
    const child = spawn(join(dir, "provision.exe"), ["16000"], { cwd: dir })
    child.stdout.on("data", (c) => (text += c))
    child.stderr.on("data", (c) => (text += c))
    const exited = new Promise<void>((resolve, reject) => {
      child.on("error", reject)
      child.on("exit", () => resolve())
    })

    // 1. The Apex login connects and is reported; the direct login is refused twice and the trader is told.
    await until("tl-1 reported connected", () => reports.some((r) => r.id === 1 && r.status === "connected"))
    await until("tl-2 reported refused", () => reports.some((r) => r.id === 2 && r.status === "reauth"))
    const refusal = reports.find((r) => r.id === 2 && r.status === "reauth")!
    assert.equal(refusal.message, "Tradovate didn't accept this login: Incorrect username or password")
    const refusedAfter = polls

    // 2. The Apex trader changes their password; the direct trader enters theirs again, right this time.
    await new Promise((r) => setTimeout(r, 2500))
    logins = [apex("new password"), direct("right", "pending"), waiting, notOurs, blank]
    await until("tl-2 connected after being entered again", () => reports.some((r) => r.id === 2 && r.status === "connected"))
    await until("tl-1 connected again with the new password", () => reports.filter((r) => r.id === 1 && r.status === "connected").length === 2)

    // 3. The Apex login is taken out in TradeLoop.
    logins = [direct("right", "connected"), waiting, notOurs, blank]
    await new Promise((r) => setTimeout(r, 2500))
    await exited

    assert.match(text, /harness done/, text)
    const asked = text.split(/\r?\n/).filter((l) => l.startsWith("ASKED ")).map((l) => l.slice(6))
    const of = (name: string) => asked.filter((a) => a.split(" ")[1] === name)
    // the Apex login: connected on Tradovate's simulation side, not saved to connect by itself; dropped and
    // connected again when its password changed; disconnected when it was taken out
    assert.deepEqual(of("tl-1"), ["connect tl-1 Simulation startup=False", "disconnect tl-1", "connect tl-1 Simulation startup=False", "disconnect tl-1"])
    // the direct login: live; tried twice with the wrong password and then left until it was entered again
    assert.deepEqual(of("tl-2"), ["connect tl-2 Live startup=False", "connect tl-2 Live startup=False", "connect tl-2 Live startup=False"])
    assert.ok(polls - refusedAfter >= 3, "it kept reading the list while tl-2 waited, and did not try it")
    // never: a login waiting for its trader, a name that isn't ours, a login with no password, the operator's own connection
    for (const never of ["tl-3", "other-4", "tl-5", "My"]) assert.deepEqual(of(never), [], never)
    const live = text.split(/\r?\n/).filter((l) => l.startsWith("LIVE ")).map((l) => l.slice(5))
    assert.deepEqual(live.sort(), ["My NinjaTrader operator Connected", "tl-2 direct Connected"])
    assert.match(text, /MULTI True/)
    // what was told to the worker, in order, and nothing else
    assert.deepEqual(reports.map((r) => [r.id, r.status]), [[1, "connected"], [2, "reauth"], ...reports.slice(2).map((r) => [r.id, r.status])])
    assert.deepEqual(reports.slice(2).map((r) => `${r.id} ${r.status}`).sort(), ["1 connected", "2 connected"])
    assert.equal(unauthorized, 0)
    // nothing a trader typed is in what the add-on printed
    for (const secret of ['p"a', "new password", "right", "wrong", "apex user", "direct"]) assert.ok(!text.split(/\r?\n/).filter((l) => l.startsWith("[TradeLoop]")).join("\n").includes(secret), secret)
    assert.match(text, /\[TradeLoop\] tl-1: connected\./)
    assert.match(text, /\[TradeLoop\] tl-2: Tradovate refused the login\. Waiting for the trader to enter it again\./)
  } finally {
    server.close()
  }
})
