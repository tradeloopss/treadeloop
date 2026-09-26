import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addonSource, ADDON_VERSION } from "@/lib/ninjatrader/addon-source"
import { parsePayload } from "@/lib/ninjatrader/payload"

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
  } finally {
    server.close()
  }
})
