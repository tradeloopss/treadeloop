import { test } from "node:test"
import assert from "node:assert/strict"
import { authorizeFrame, isShutdown, parseFrame, penaltyTicket, propsEvents, requestFrame, responseFor } from "@/lib/tradovate/protocol"

test("parses the four server frame types", () => {
  assert.deepEqual(parseFrame("o"), { type: "open" })
  assert.deepEqual(parseFrame("h"), { type: "heartbeat" })
  assert.deepEqual(parseFrame('c[1000,"bye"]'), { type: "close", code: 1000, reason: "bye" })
  const data = parseFrame('a[{"i":0,"s":200}]')
  assert.equal(data.type, "data")
  assert.deepEqual(data.type === "data" && data.messages, [{ i: 0, s: 200 }])
  assert.equal(parseFrame("a{not json").type, "unknown")
  assert.equal(parseFrame("zzz").type, "unknown")
})

test("builds the authorize and request frames", () => {
  assert.equal(authorizeFrame("TOKEN"), "authorize\n0\n\nTOKEN")
  assert.equal(requestFrame("user/syncrequest", 1, { users: [1], entityTypes: ["fill"] }), 'user/syncrequest\n1\n\n{"users":[1],"entityTypes":["fill"]}')
  assert.equal(requestFrame("account/list", 7), "account/list\n7\n\n")
})

test("extracts props events and ignores malformed ones", () => {
  const events = propsEvents([
    { e: "props", d: { entityType: "fill", eventType: "Created", entity: { id: 1 } } },
    { e: "props", d: { entityType: "fill", eventType: "Exploded", entity: { id: 2 } } },
    { e: "props", d: { entityType: "order", eventType: "Updated" } },
    { i: 3, s: 200, d: {} },
  ])
  assert.deepEqual(events, [{ entityType: "fill", eventType: "Created", entity: { id: 1 } }])
})

test("finds a response by id, but never a props event", () => {
  const msgs = [{ e: "props", i: 1, d: {} }, { i: 1, s: 200, d: { ok: true } }]
  assert.deepEqual(responseFor(msgs, 1), { i: 1, s: 200, d: { ok: true } })
  assert.equal(responseFor(msgs, 2), null)
  assert.equal(isShutdown([{ e: "shutdown" }]), true)
})

test("reads penalty tickets", () => {
  assert.deepEqual(penaltyTicket({ "p-ticket": "t1", "p-time": 3 }), { ticket: "t1", waitMs: 3000, captcha: false })
  assert.deepEqual(penaltyTicket({ "p-ticket": "t2", "p-time": 0, "p-captcha": true }), { ticket: "t2", waitMs: 0, captcha: true })
  assert.equal(penaltyTicket({ id: 1 }), null)
  assert.equal(penaltyTicket([]), null)
})
