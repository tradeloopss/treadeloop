import { test } from "node:test"
import assert from "node:assert/strict"
import { TradovateSocket } from "@/lib/tradovate/realtime"
import { SYNC_ENTITY_TYPES } from "@/lib/tradovate/config"
import type { RealtimeEvent, RealtimeStatus } from "@/lib/providers/types"
import { FakeSocket, FakeTimers } from "./helpers"

function setup(token = { value: "TOKEN-1" }) {
  const timers = new FakeTimers()
  const sockets: FakeSocket[] = []
  const events: RealtimeEvent[] = []
  const snapshots: [string, Record<string, unknown[]>][] = []
  const statuses: RealtimeStatus[] = []
  const socket = new TradovateSocket({
    environment: "demo",
    url: "wss://demo.example/v1/websocket",
    token: () => token.value,
    userId: "900001",
    entityTypes: SYNC_ENTITY_TYPES,
    timers,
    createSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    handlers: {
      onEvent: (e) => void events.push(e),
      onSnapshot: (env, entities) => void snapshots.push([env, entities]),
      onStatus: (s) => void statuses.push(s),
    },
  })
  return { timers, sockets, events, snapshots, statuses, socket, token }
}

// Server side of a normal connect: open, accept the token, answer the sync request.
function handshake(s: FakeSocket, snapshot: Record<string, unknown[]> = { accounts: [{ id: 5001 }] }) {
  s.receive("o")
  s.data([{ i: 0, s: 200 }])
  s.data([{ i: 1, s: 200, d: snapshot }])
}

test("authorizes after open, then sends exactly one syncrequest with entity types", () => {
  const { sockets, socket, statuses, snapshots } = setup()
  socket.start()
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].url, "wss://demo.example/v1/websocket")
  sockets[0].receive("o")
  assert.equal(sockets[0].sent[0], "authorize\n0\n\nTOKEN-1")
  assert.equal(sockets[0].requests("user/syncrequest").length, 0, "nothing before authorization")
  sockets[0].data([{ i: 0, s: 200 }])
  const [sync] = sockets[0].requests("user/syncrequest")
  assert.deepEqual(JSON.parse(sync.split("\n")[3]), { users: [900001], entityTypes: SYNC_ENTITY_TYPES })
  sockets[0].data([{ i: 1, s: 200, d: { accounts: [{ id: 5001 }], fills: [] } }])
  sockets[0].data([{ i: 0, s: 200 }]) // a stray repeat changes nothing
  assert.equal(sockets[0].requests("user/syncrequest").length, 1)
  assert.deepEqual(statuses, ["connecting", "authorizing", "live"])
  assert.deepEqual(snapshots, [["demo", { accounts: [{ id: 5001 }], fills: [] }]])
})

test("heartbeats every 2.5 s, also while messages pour in", () => {
  const { sockets, socket, timers } = setup()
  socket.start()
  handshake(sockets[0])
  timers.advance(2_499)
  assert.equal(sockets[0].heartbeats(), 0)
  for (let i = 0; i < 40; i++) {
    sockets[0].data([{ e: "props", d: { entityType: "order", eventType: "Updated", entity: { id: i } } }])
    timers.advance(250)
  }
  // 2 499 + 10 000 ms → heartbeats at 2.5, 5, 7.5, 10 and 12.5 s... minus the last (12.499 s)
  assert.equal(sockets[0].heartbeats(), 4)
})

test("dispatches realtime changes with their environment", () => {
  const { sockets, socket, events } = setup()
  socket.start()
  handshake(sockets[0])
  sockets[0].data([
    { e: "props", d: { entityType: "fill", eventType: "Created", entity: { id: 1201, orderId: 2001 } } },
    { e: "props", d: { entityType: "position", eventType: "Updated", entity: { id: 8001 } } },
  ])
  assert.deepEqual(
    events.map((e) => [e.environment, e.entityType, e.eventType]),
    [
      ["demo", "fill", "Created"],
      ["demo", "position", "Updated"],
    ],
  )
})

test("a socket silent for 15 s is replaced; the new one re-authorizes with the current token", () => {
  const { sockets, socket, timers, statuses, token } = setup()
  socket.start()
  handshake(sockets[0])
  token.value = "TOKEN-2" // renewed in the meantime
  timers.advance(14_000)
  assert.equal(sockets.length, 1, "still within the silence limit")
  timers.advance(2_000)
  assert.ok(sockets[0].closed, "silent socket closed")
  assert.equal(statuses.at(-1), "degraded")
  timers.advance(1_000) // first backoff is at most 1 s
  assert.equal(sockets.length, 2)
  handshake(sockets[1])
  assert.equal(sockets[1].sent[0], "authorize\n0\n\nTOKEN-2")
  assert.equal(sockets[1].requests("user/syncrequest").length, 1, "one syncrequest per socket")
  assert.equal(statuses.at(-1), "live")
})

test("reconnect backoff grows while the server stays away, and resets once live", () => {
  const { sockets, socket, timers } = setup()
  socket.start()
  const created: number[] = []
  for (let round = 0; round < 5; round++) {
    const before = sockets.length
    sockets.at(-1)!.drop()
    let waited = 0
    while (sockets.length === before) {
      timers.advance(100)
      waited += 100
    }
    created.push(waited)
  }
  // backoff(attempt) is within [cap/2, cap] for cap = 1 s × 2^attempt
  created.forEach((ms, attempt) => assert.ok(ms >= 500 * 2 ** attempt && ms <= 1000 * 2 ** attempt + 100, `attempt ${attempt}: ${ms} ms`))
  handshake(sockets.at(-1)!)
  const before = sockets.length
  sockets.at(-1)!.drop()
  timers.advance(1_000)
  assert.equal(sockets.length, before + 1, "back to a short wait after a successful connect")
})

test("a refused token reconnects without sending a syncrequest", () => {
  const { sockets, socket, timers } = setup()
  socket.start()
  sockets[0].receive("o")
  sockets[0].data([{ i: 0, s: 401 }])
  assert.equal(sockets[0].requests("user/syncrequest").length, 0)
  assert.ok(sockets[0].closed)
  timers.advance(1_000)
  assert.equal(sockets.length, 2)
})

test("server close frames and shutdown notices trigger a reconnect", () => {
  const { sockets, socket, timers } = setup()
  socket.start()
  handshake(sockets[0])
  sockets[0].receive('c[1000,"maintenance"]')
  timers.advance(1_000)
  assert.equal(sockets.length, 2)
  handshake(sockets[1])
  sockets[1].data([{ e: "shutdown", d: { reason: "restart" } }])
  timers.advance(1_000)
  assert.equal(sockets.length, 3)
})

test("close() stops everything: no heartbeats, no reconnects", async () => {
  const { sockets, socket, timers, statuses } = setup()
  socket.start()
  handshake(sockets[0])
  await socket.close()
  const sent = sockets[0].sent.length
  timers.advance(120_000)
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].sent.length, sent)
  assert.equal(statuses.at(-1), "closed")
})
