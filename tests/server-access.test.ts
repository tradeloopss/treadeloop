import { test } from "node:test"
import assert from "node:assert/strict"
import { serverAccessBlock } from "@/lib/server-access"
import { findArticle } from "@/lib/help/content"

// A prop firm that forbids reaching its accounts from a server is never
// connected to our sync server: the trader would be the one to lose the
// account. What these hold the rule to: the firm's server is refused however
// its name is written, no other broker is caught by it, and the trader is
// sent to a guide that exists.

test("a FundingPips server is refused, however the name is spelled", () => {
  for (const server of ["FundingPips-SIM", "FundingPips2-Live", "fundingpips-demo", "Funding Pips - Live", "FUNDING-PIPS.Server3", "  FundingPipsGlobal-Real  "]) {
    const block = serverAccessBlock(server)
    assert.equal(block?.firm, "FundingPips", server)
    assert.match(block!.message, /can't be connected/)
  }
})

test("the brokers and firms TradeLoop does connect are not caught by it", () => {
  for (const server of ["Exness-MT5Trial15", "Exness-Real6", "JustMarkets-Demo3", "FTMO-Server3", "FundedNext-Server", "FundedNext-Demo", "ACGMarkets-Main", "FundingTraders-Live", "Pipsfunding-Demo", ""]) {
    assert.equal(serverAccessBlock(server), null, server)
  }
})

test("the refusal sends the trader to a guide that is in the Help Center", () => {
  const { guide } = serverAccessBlock("FundingPips-SIM")!
  assert.equal(guide.href, "/help/connecting-accounts/fundingpips")
  const found = findArticle("connecting-accounts", "fundingpips")
  assert.ok(found, "the guide the refusal links to")
  // the guide says the one thing that keeps the account: nothing is copied into FundingPips
  const text = found!.article.body.map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : "")).join(" ")
  assert.match(text, /Never copy trades into a FundingPips account/)
})
