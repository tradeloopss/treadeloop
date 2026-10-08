import { test } from "node:test"
import assert from "node:assert/strict"
import { accountKind, propFirmOf, validateSharing } from "@/lib/compliance/kind"
import { PROP_FIRM_NAMES } from "@/lib/propfirm-presets"

// A strategy shared between people is copied between broker accounts only.
// What these hold the rule to: every prop firm TradeLoop knows by name is told
// from a broker, an account its trader tracks as a prop account is one, the
// futures logins are not taken for brokers', and both ends are asked.

const mt5 = (server: string, broker: string | null = null) => ({ platform: "mt5" as const, server, broker })

test("an ordinary MetaTrader account with a broker is a broker account", () => {
  for (const [server, broker] of [["Exness-MT5Trial15", "Exness Technologies Ltd"], ["Exness-Real6", null], ["JustMarkets-Demo3", "Just Global Markets Ltd."], ["ICMarketsSC-MT5-2", "Raw Trading Ltd"], ["Pepperstone-MT5-Live01", null], ["Tradin-Live", "Tradin Ltd"], ["XMTrading-MT5 3", null], ["MonetaMarkets-Live", null]] as const) {
    assert.deepEqual(accountKind(mt5(server, broker)), { kind: "broker" }, server)
  }
  assert.deepEqual(accountKind({ platform: "mt4", server: "Exness-Real6", broker: null }), { kind: "broker" })
})

test("a prop firm's account is told by its server or its label, and is never a broker account", () => {
  for (const server of ["FTMO-Server3", "FTMO-Demo2", "FundedNext-Server2", "FundingPips2-SIM", "FundingPips-Prime", "ACGMarkets-Main", "The5ers-Live", "BlueGuardian-Server", "E8Markets-Live", "BrightFunded-Live"]) {
    const k = accountKind(mt5(server))
    assert.equal(k.kind, "prop", server)
    assert.match(k.kind === "prop" ? k.reason : "", /prop-firm account can't be part of a strategy shared between people/)
  }
  // by the label the account carries, when the server says nothing
  assert.equal(accountKind(mt5("Server-Live7", "FTMO S.R.O.")).kind, "prop")
  assert.equal(accountKind(mt5("Live-12", "Alpha Capital Group")).kind, "prop")
  assert.equal(propFirmOf({ server: "FundedNext-Demo", broker: null }), "FundedNext")
  // every firm TradeLoop has rules for is recognised by its own name
  for (const firm of PROP_FIRM_NAMES) assert.equal(accountKind(mt5(`${firm}-Live`)).kind, "prop", firm)
})

test("a provider with rules of its own, and an account tracked as a prop account, are prop accounts whatever the server is called", () => {
  const byProvider = accountKind({ platform: "mt5", server: "Some-Server", broker: null, provider: "FundingPips" })
  assert.deepEqual(byProvider, { kind: "prop", reason: "FundingPips is a prop firm: its accounts can't be part of a strategy shared between people." })
  const tracked = accountKind({ platform: "mt5", server: "Exness-Real6", broker: "Exness", propTracked: true })
  assert.equal(tracked.kind, "prop")
  assert.match(tracked.kind === "prop" ? tracked.reason : "", /tracked as a prop-firm account/)
})

test("only a MetaTrader connection is taken for a broker account: a futures login, an import and a manual account are not", () => {
  for (const platform of ["rithmic", "other", null] as const) {
    const k = accountKind({ platform, server: null, broker: "Some Broker" })
    assert.equal(k.kind, "other", String(platform))
    assert.match(k.kind === "other" ? k.reason : "", /Only a MetaTrader account with a broker/)
  }
  // and a futures login that names a prop firm is one
  assert.equal(accountKind({ platform: "rithmic", server: null, broker: "Apex Trader Funding" }).kind, "prop")
})

test("sharing asks both ends: the strategy's account and the follower's must each be a broker's", () => {
  const broker = accountKind(mt5("Exness-Real6"))
  const prop = accountKind(mt5("FTMO-Server3"))
  assert.deepEqual(validateSharing(broker, broker), { allowed: true })
  const intoProp = validateSharing(broker, prop)
  assert.deepEqual(intoProp.allowed ? null : intoProp.reasonCode, "SHARED_FOLLOWER_NOT_BROKER")
  assert.match(intoProp.allowed ? "" : intoProp.message, /Only your own broker accounts can copy a friend's strategy/)
  const fromProp = validateSharing(prop, broker)
  assert.deepEqual(fromProp.allowed ? null : fromProp.reasonCode, "SHARED_LEADER_NOT_BROKER")
  // the strategy's own account is asked first
  assert.deepEqual(((v) => (v.allowed ? null : v.reasonCode))(validateSharing(prop, prop)), "SHARED_LEADER_NOT_BROKER")
})
