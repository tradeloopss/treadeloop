import { test } from "node:test"
import assert from "node:assert/strict"
import { TRADING_CHECK_NOTES, followLogin, tradingCheckOf, tradingUsable } from "@/lib/order-execution/trading-check"

// A trading password is put to the broker when it is saved, and what the
// broker said decides whether orders are sent with it.

test("only a password the broker turned down stops orders; one not asked about yet does not", () => {
  assert.deepEqual([null, "pending", "ok", "read_only", "rejected"].map((c) => tradingUsable(c as never)), [true, true, true, false, false])
  // the worker's own mark for one it has picked up reads as still waiting; anything unknown as not asked
  assert.deepEqual(["checking", "pending", "ok", "read_only", "rejected", "", "nonsense", null, undefined].map((c) => tradingCheckOf(c)), ["pending", "pending", "ok", "read_only", "rejected", null, null, null, null])
  // each refusal tells its trader where to put it right
  for (const note of Object.values(TRADING_CHECK_NOTES)) assert.match(note, /Allow orders/)
})

test("reconnecting with a new login password takes the trading password along only when the two were the same", () => {
  // "the password I connected with is the one to trade with": stored alike, so it follows, and is checked again
  assert.deepEqual(followLogin({ passwordEnc: "old", tradingPasswordEnc: "old" }, "new"), { tradingPasswordEnc: "new", tradingCheck: "pending", tradingCheckAt: null })
  // a trading password entered by itself is left as it is
  assert.equal(followLogin({ passwordEnc: "old", tradingPasswordEnc: "typed" }, "new"), null)
  // and an account orders were never allowed on does not start taking them
  assert.equal(followLogin({ passwordEnc: "old", tradingPasswordEnc: null }, "new"), null)
})
