import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AGENT_VERSION, agentSource } from "@/lib/vps/agent-source"

const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
const KEY = "tlnt_" + "a".repeat(43)

test("agent source: key/url/version filled in, nothing injectable, and read-only", () => {
  const src = agentSource({ key: KEY, cloudUrl: "https://www.tradeloop.pro/api/vps/agent" })
  assert.ok(src.includes(`private const string AgentKey = "${KEY}";`))
  assert.ok(src.includes(`private const string CloudUrl = "https://www.tradeloop.pro/api/vps/agent";`))
  assert.ok(src.includes(`private const string Version = "${AGENT_VERSION}";`))
  assert.ok(!src.includes("__TRADELOOP_"), "no placeholder left")
  assert.ok(!/\r(?!\n)/.test(src) && src.includes("\r\n"), "CRLF line endings")
  // READ-ONLY: no order-entry anywhere
  assert.doesNotMatch(src, /\b(SubmitOrder|SubmitOrderUnmanaged|CancelOrder|ChangeOrder|ClosePosition|EnterLong|EnterShort|ExitLong|ExitShort|CreateOrder|AtmStrategy)\b/)
  assert.doesNotMatch(src, /\.(Submit|Cancel|Change|Flatten)\(/)
  // no broker credential handling in the agent
  assert.doesNotMatch(src, /Password|Tradovate/)
  assert.throws(() => agentSource({ key: 'tlnt_x"; evil', cloudUrl: "https://x.example" }))
  assert.throws(() => agentSource({ key: KEY, cloudUrl: 'https://x.example/"+evil' }))
})

test("agent compiles as a standalone C# exe (BCL only, no NinjaTrader reference)", { skip: !existsSync(CSC) && "csc.exe not available" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "tl-agent-"))
  writeFileSync(join(dir, "TradeLoopVpsAgent.cs"), agentSource({ key: KEY, cloudUrl: `https://www.tradeloop.pro/api/vps/agent` }))
  // compile only — the agent's Main() loops forever, so it is never run here
  const out = execFileSync(CSC, ["/nologo", "/warnaserror-", "/t:exe", "/out:agent.exe", "TradeLoopVpsAgent.cs"], { cwd: dir, encoding: "utf8" })
  assert.ok(!/error CS/.test(out), out)
})
