import { test } from "node:test"
import assert from "node:assert/strict"
import { BUILT_IN_RULE_SETS, FUNDINGPIPS_V1, cleanRuleSet, type ProviderRuleSet } from "@/lib/compliance/rules"
import { detectProvider, integrationStatus, providerProfile, ruleLines, validateConnection, validateDirection, validateExecution, validateGroup, validateRole, type Party } from "@/lib/compliance/engine"

// A provider's rules are data, and one engine answers every question about
// them. What these hold it to: FundingPips' accounts are recognised by their
// servers and no other broker's are; with the rules as FundingPips publishes
// them nothing of TradeLoop's reaches a FundingPips account; and the copy
// directions come out as the provider states them, whatever else is switched on.

const FP = FUNDINGPIPS_V1
// FundingPips as it would be had it approved TradeLoop's servers, read-only: an administrator's later version
const APPROVED: ProviderRuleSet = { ...FP, version: 2, rules: { ...FP.rules, cloudConnection: "allowed" } }
// and had it approved orders too
const TRADABLE: ProviderRuleSet = { ...APPROVED, version: 3, rules: { ...APPROVED.rules, execution: "allowed", masterCredential: "any" } }
const external: Party = { set: null }
const fp = (set: ProviderRuleSet, over: Partial<Party> = {}): Party => ({ set, ...over })
const code = (v: ReturnType<typeof validateDirection>) => (v.allowed ? "ALLOWED" : v.reasonCode)

test("a FundingPips account is recognised by its server, however the name is written, and no other broker's is", () => {
  // FundingPips' own pages (Account Workspace, Free Trial, Prime Account), read 7 Oct 2026
  for (const server of ["FundingPips-Trial", "FundingPips-Prime", "FundingPips-SIM", "FundingPips-SIM1", "FundingPips2-SIM", "fundingpips-demo", "Funding Pips - Live", "  FUNDING-PIPS.Server3 "]) {
    assert.equal(detectProvider(BUILT_IN_RULE_SETS, server)?.provider, "fundingpips", server)
  }
  // Tradin is the broker FundingPips pays rewards to: an ordinary broker account
  for (const server of ["Exness-MT5Trial15", "JustMarkets-Demo3", "FTMO-Server3", "FundedNext-Server", "ACGMarkets-Main", "FundingTraders-Live", "Pipsfunding-Demo", "Tradin-Live", "XMTrading-MT5 3", "", null, undefined]) {
    assert.equal(detectProvider(BUILT_IN_RULE_SETS, server), null, String(server))
  }
})

test("as FundingPips' rules stand, its accounts are not connected: a server may not reach one, the read-only password included", () => {
  const v = validateConnection(FP, { credential: "investor" })
  assert.equal(v.allowed, false)
  assert.deepEqual(v.allowed ? null : [v.provider, v.reasonCode], ["FundingPips", "CLOUD_CONNECTION_NOT_APPROVED"])
  assert.match(v.allowed ? "" : v.message, /even with the read-only password/)
  assert.equal(integrationStatus(FP), "approval_required")
  // a broker with no rule set has no rules of its own to apply
  assert.deepEqual(validateConnection(null, { credential: "investor" }), { allowed: true, provider: null })
  assert.deepEqual(validateExecution(null), { allowed: true, provider: null })
  // and so no copy group can have one in it, whichever way round
  assert.equal(code(validateDirection(fp(FP), external)), "CLOUD_CONNECTION_NOT_APPROVED")
  assert.equal(code(validateDirection(external, fp(FP))), "INBOUND_COPY_BLOCKED")
  assert.equal(code(validateRole(fp(FP), "leader")), "CLOUD_CONNECTION_NOT_APPROVED")
})

test("the copy directions are the provider's own: FundingPips to an external account passes, into FundingPips never does", () => {
  // FundingPips -> External: PASS, once its accounts may be read
  assert.equal(code(validateDirection(fp(APPROVED), external)), "ALLOWED")
  assert.equal(code(validateRole(fp(APPROVED), "leader")), "ALLOWED")
  // External -> FundingPips: FAIL, whatever else has been approved
  for (const set of [FP, APPROVED, TRADABLE]) {
    const v = validateDirection(external, fp(set, { ownerVerified: true }))
    assert.equal(code(v), "INBOUND_COPY_BLOCKED", `v${set.version}`)
    assert.match(v.allowed ? "" : v.message, /does not permit this copy direction/)
    assert.match(v.allowed ? "" : v.message, /Choose an external account as the Follower instead/)
  }
  // read-only approval is not approval to trade: a FundingPips account still receives no order
  assert.equal(code(validateExecution(APPROVED)), "EXECUTION_BLOCKED")
  assert.equal(code(validateRole(fp(APPROVED), "follower")), "EXECUTION_BLOCKED")
  assert.equal(code(validateConnection(APPROVED, { credential: "trading" })), "MASTER_CREDENTIAL")
  assert.equal(code(validateConnection(APPROVED, { credential: "investor" })), "ALLOWED")
})

test("own FundingPips to own FundingPips passes only for accounts known to be one person's; another person's never does", () => {
  const mine = { ownerVerified: true }
  // Own FP -> Own FP: PASS
  assert.equal(code(validateDirection(fp(TRADABLE, mine), fp(TRADABLE, mine))), "ALLOWED")
  // ownership that can't be confirmed is not assumed, and the trader is sent to the provider's own copier
  const unproven = validateDirection(fp(TRADABLE), fp(TRADABLE))
  assert.equal(code(unproven), "OWNERSHIP_UNVERIFIED")
  assert.match(unproven.allowed ? "" : unproven.message, /Use FundingPips' Trade Copier for that/)
  assert.equal(code(validateDirection(fp(TRADABLE, mine), fp(TRADABLE))), "OWNERSHIP_UNVERIFIED")
  // Other user's FP -> FP: FAIL (the same login is connected by someone else as well)
  assert.equal(code(validateDirection(fp(TRADABLE, { ...mine, sharedLogin: true }), fp(TRADABLE, mine))), "CROSS_USER_BLOCKED")
  assert.equal(code(validateDirection(fp(TRADABLE, mine), fp(TRADABLE, { ...mine, sharedLogin: true }))), "CROSS_USER_BLOCKED")
  // read-only approval alone: no order goes to the follower, so it is not copied to
  assert.equal(code(validateDirection(fp(APPROVED, mine), fp(APPROVED, mine))), "EXECUTION_BLOCKED")
})

test("a group is checked follower by follower, and an external-to-external group is nobody's business", () => {
  const master = { accountId: 1, ...fp(APPROVED) }
  const out = validateGroup(master, [{ accountId: 2, set: null }, { accountId: 3, ...fp(APPROVED) }, { accountId: 4, set: null }])
  assert.deepEqual(out.map((o) => [o.accountId, code(o.verdict)]), [[2, "ALLOWED"], [3, "OWNERSHIP_UNVERIFIED"], [4, "ALLOWED"]])
  assert.deepEqual(validateGroup({ accountId: 1, set: null }, [{ accountId: 2, set: null }]).map((o) => o.verdict.allowed), [true])
})

test("a switched-off integration connects nothing, and a provider that blocks outward copying is obeyed too", () => {
  const off: ProviderRuleSet = { ...TRADABLE, status: "disabled" }
  assert.equal(code(validateConnection(off, { credential: "investor" })), "INTEGRATION_DISABLED")
  assert.equal(integrationStatus(off), "disabled")
  assert.equal(code(validateDirection(fp(off), external)), "INTEGRATION_DISABLED")
  const closed: ProviderRuleSet = { ...TRADABLE, rules: { ...TRADABLE.rules, toExternal: "blocked", ownToOwn: "blocked" } }
  assert.equal(code(validateDirection(fp(closed), external)), "OUTBOUND_COPY_BLOCKED")
  assert.equal(code(validateDirection(fp(closed, { ownerVerified: true }), fp(closed, { ownerVerified: true }))), "OWN_TO_OWN_BLOCKED")
})

test("what the trader is shown is the rule set itself: the Safe Mode lines, the profile's name and its sources", () => {
  assert.deepEqual(
    ruleLines(FP).map((l) => [l.label, l.allowed]),
    [
      ["FundingPips → External", true],
      ["Own FundingPips → Own FundingPips", true],
      ["External → FundingPips", false],
      ["Other user's FundingPips → Your FundingPips", false],
      ["VPS/VPN-based connection", false],
    ],
  )
  const p = providerProfile(FP)
  assert.deepEqual([p.profile, p.statusLabel, p.masterCredential, p.connection.allowed, p.guide], ["FUNDINGPIPS_V1", "Approval required", "Investor / read-only", false, "/connecting-accounts/fundingpips"])
  // official pages only
  assert.ok(p.sources.length >= 1 && p.sources.every((s) => s.url.startsWith("https://help.fundingpips.com/")))
  assert.equal(providerProfile(APPROVED).statusLabel, "Supported with restrictions")
})

test("a new version of the rules is checked as typed: a value that isn't an option is refused, never guessed", () => {
  const next = cleanRuleSet({ ...FP, rules: { ...FP.rules, cloudConnection: "allowed" }, note: "FundingPips approved our address in writing on 1 Nov 2026." }, FP)
  assert.ok(typeof next !== "string")
  if (typeof next === "string") return
  assert.deepEqual([next.version, next.rules.cloudConnection, next.provider, next.servers], [2, "allowed", "fundingpips", ["fundingpips"]])
  const bad = (over: object, rules: object = {}) => cleanRuleSet({ ...FP, note: "A reason that is long enough.", ...over, rules: { ...FP.rules, ...rules } }, FP)
  assert.match(String(bad({}, { fromExternal: "maybe" })), /isn't an option/)
  assert.match(String(bad({ note: "ok" })), /why this version/)
  assert.match(String(bad({ sources: [] })), /at least one source/)
  assert.match(String(bad({ sources: [{ label: "A blog", url: "http://example.com" }] })), /https:\/\//)
  assert.match(String(bad({ effectiveDate: "next week" })), /effective date/)
  assert.match(String(bad({}, { maxAllocation: -5 })), /maximum allocation/)
  // orders can't be switched on for an account TradeLoop may not even reach
  assert.match(String(bad({}, { execution: "allowed" })), /Orders can't be allowed/)
})
