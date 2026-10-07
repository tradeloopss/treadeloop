import { test } from "node:test"
import assert from "node:assert/strict"
import { FUNDINGPIPS_GUIDE, copyBlockMessage, serverAccessBlock } from "@/lib/server-access"
import { findArticle } from "@/lib/help/content"

// A prop firm that forbids reaching its accounts from a server is never
// connected to our sync server: the trader would be the one to lose the
// account. What these hold the rule to: the firm's server is refused however
// its name is written, no other broker is caught by it, and the trader is
// sent to a guide that exists.

test("every FundingPips MT5 server is refused: the ones its help pages list, and the name however it is spelled", () => {
  // FundingPips' own pages (Account Workspace, Free Trial, Prime Account), read 7 Oct 2026
  const listed = ["FundingPips-Trial", "FundingPips-Prime", "FundingPips-SIM", "FundingPips-SIM1", "FundingPips2-SIM"]
  for (const server of [...listed, "FundingPips2-Live", "fundingpips-demo", "Funding Pips - Live", "FUNDING-PIPS.Server3", "  FundingPipsGlobal-Real  "]) {
    const block = serverAccessBlock(server)
    assert.equal(block?.firm, "FundingPips", server)
    assert.match(block!.message, /can't be connected/)
    // the read-only password changes nothing: its support said so in writing
    assert.match(block!.message, /even with the read-only password/)
  }
})

test("the brokers and firms TradeLoop does connect are not caught by it", () => {
  // Tradin is the broker FundingPips pays rewards to: an ordinary broker account, not a FundingPips one
  for (const server of ["Exness-MT5Trial15", "Exness-Real6", "JustMarkets-Demo3", "FTMO-Server3", "FundedNext-Server", "FundedNext-Demo", "ACGMarkets-Main", "FundingTraders-Live", "Pipsfunding-Demo", "Tradin-Live", "XMTrading-MT5 3", ""]) {
    assert.equal(serverAccessBlock(server), null, server)
  }
})

test("the refusal sends the trader to a guide that is in the Help Center", () => {
  const { guide } = serverAccessBlock("FundingPips-SIM")!
  assert.equal(guide.href, "/help/connecting-accounts/fundingpips")
  assert.equal(FUNDINGPIPS_GUIDE, guide.href)
  const found = findArticle("connecting-accounts", "fundingpips")
  assert.ok(found, "the guide the refusal links to")
  // the guide says the one thing that keeps the account: nothing is copied into FundingPips
  const text = found!.article.body.map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : "")).join(" ")
  assert.match(text, /Never copy trades into a FundingPips account/)
  // and that between two FundingPips accounts it is FundingPips' own copier, not this one
  assert.match(text, /use FundingPips' Trade Copier/)
})

test("in Copy Trading the same account is neither copied from nor to, and the reason says so", () => {
  const message = copyBlockMessage(serverAccessBlock("FundingPips-Prime")!)
  assert.match(message, /FundingPips accounts can't be in a copy group/)
  assert.match(message, /nothing may be copied into one/)
})
