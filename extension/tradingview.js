// Runs in every TradingView tab. While the tab is open it asks TradingView's
// paper-trading server — the same calls TradingView's own page makes, with
// the same login cookies the browser already holds — for the accounts and
// their fills, and posts anything TradeLoop hasn't confirmed yet to the
// journal this browser is paired with.
//
// Nothing here touches the page, and nothing of the TradingView login is
// read or sent anywhere: the cookies ride along on the request to
// TradingView because the browser attaches them, and what goes to TradeLoop
// is the list of fills plus the pairing token from the pairing page.
;(() => {
  const CFG = globalThis.TRADELOOP
  const storage = chrome.storage.local
  const log = (...args) => console.debug("[TradeLoop]", ...args)

  // ---- storage -------------------------------------------------------------

  async function getPairing() {
    const { pairing } = await storage.get("pairing")
    return pairing && pairing.token && pairing.baseUrl ? pairing : null
  }

  // addFills is folded into the running total from the value read here, so
  // two syncs finishing close together can't both start from the same
  // number.
  async function setStatus(patch, addFills = 0) {
    const { status = {} } = await storage.get("status")
    const totalFills = (status.totalFills || 0) + addFills
    await storage.set({ status: { ...status, ...patch, totalFills, updatedAt: Date.now() } })
  }

  async function getAcked() {
    const { acked = {} } = await storage.get("acked")
    return acked
  }

  async function markAcked(accountId, ids) {
    const acked = await getAcked()
    const merged = [...(acked[accountId] || []), ...ids]
    acked[accountId] = merged.slice(Math.max(0, merged.length - CFG.ackedIdsToKeep))
    await storage.set({ acked })
  }

  // ---- TradingView ---------------------------------------------------------

  class NotLoggedIn extends Error {}

  // TradingView's page sends JSON with a form content type and relies on the
  // session cookies; the request is made the same way so the server treats
  // it the same way.
  async function paperFetch(host, path, body) {
    const response = await fetch(`${host}/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 401 || response.status === 403) throw new NotLoggedIn()
    if (!response.ok) throw new Error(`TradingView answered ${response.status} for ${path}`)
    const data = await response.json()
    if (data && typeof data === "object" && !Array.isArray(data) && data.error) throw new Error(String(data.error))
    return data
  }

  async function readAccounts() {
    const data = await paperFetch(CFG.paperHosts.pro, "trading/accounts")
    const list = Array.isArray(data) ? data : Array.isArray(data?.accounts) ? data.accounts : []
    return list.filter((account) => account && account.accountId != null && !account.hidden)
  }

  function hostFor(account) {
    return account.segment === "free" && CFG.paperHosts.free ? CFG.paperHosts.free : CFG.paperHosts.pro
  }

  async function readExecutions(account) {
    const body = { limit: CFG.fillsPerAccount }
    const host = hostFor(account)
    try {
      const data = await paperFetch(host, `trading/get_trades/${account.accountId}`, body)
      return Array.isArray(data) ? data : []
    } catch (err) {
      if (err instanceof NotLoggedIn || host === CFG.paperHosts.pro) throw err
      const data = await paperFetch(CFG.paperHosts.pro, `trading/get_trades/${account.accountId}`, body)
      return Array.isArray(data) ? data : []
    }
  }

  // ---- TradeLoop -----------------------------------------------------------

  function browserLabel() {
    const data = navigator.userAgentData
    const brand = data?.brands?.find((b) => !/Not.A.Brand|Chromium/i.test(b.brand))?.brand
    const ua = navigator.userAgent
    const name = brand || (/Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Browser")
    const platform = data?.platform || (/Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "")
    return platform ? `${name} on ${platform}` : name
  }

  class Unpaired extends Error {}

  async function postToTradeLoop(pairing, accounts) {
    const response = await fetch(`${pairing.baseUrl}/api/tradingview/extension`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pairing.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: CFG.version, browser: browserLabel(), accounts }),
    })
    if (response.status === 401) throw new Unpaired()
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.error || `TradeLoop answered ${response.status}`)
    return data
  }

  // ---- the sync itself -----------------------------------------------------

  let syncing = false

  async function syncOnce(reason) {
    if (syncing) return
    const pairing = await getPairing()
    if (!pairing) return

    // Several TradingView tabs share one poll: whichever gets here first
    // takes the round, the rest see a fresh timestamp and stand down.
    const { lastPollAt = 0 } = await storage.get("lastPollAt")
    if (reason !== "manual" && Date.now() - lastPollAt < CFG.pollSeconds * 800) return
    await storage.set({ lastPollAt: Date.now() })

    syncing = true
    try {
      const accounts = await readAccounts()
      const acked = await getAcked()
      const report = []
      for (const account of accounts) {
        const accountId = String(account.accountId)
        const executions = await readExecutions(account)
        const known = new Set(acked[accountId] || [])
        const fresh = executions.filter((e) => e && e.id != null && !known.has(String(e.id)))
        report.push({
          accountId,
          name: account.name ?? null,
          default: account.default === true,
          currency: account.currency ?? "USD",
          balance: typeof account.balance === "number" ? account.balance : null,
          initialBalance: typeof account.initialBalance === "number" ? account.initialBalance : null,
          executions: fresh.map((e) => ({
            id: String(e.id),
            symbol: e.symbol,
            side: e.side,
            qty: e.qty,
            price: e.price,
            time: e.time,
            commission: e.commission ?? null,
            order: e.order ?? null,
          })),
        })
      }

      const result = await postToTradeLoop(pairing, report)
      // Only what TradeLoop says it stored counts as sent; an account it
      // couldn't record goes again next round.
      const stored = new Set((result.accounts || []).map((a) => String(a.accountId)))
      for (const account of report) {
        if (account.executions.length > 0 && stored.has(account.accountId)) {
          await markAcked(account.accountId, account.executions.map((e) => e.id))
        }
      }

      const newFills = report.reduce((n, a) => n + a.executions.length, 0)
      const newTrades = (result.accounts || []).reduce((n, a) => n + (a.newTrades || 0), 0)
      await setStatus({
        lastSyncAt: Date.now(),
        lastError: null,
        accounts: (result.accounts || []).map((a) => ({ accountId: a.accountId, name: a.accountName })),
        lastNewFills: newFills,
        lastNewTrades: newTrades,
      }, newFills)
      if (newFills > 0) log(`sent ${newFills} fill(s), ${newTrades} new trade(s) journaled`)
    } catch (err) {
      if (err instanceof Unpaired) {
        // The journal no longer knows this browser — the trader unpaired it
        // there. Forget the token; the popup says how to pair again.
        await storage.remove(["pairing", "acked"])
        await setStatus({ lastError: "unpaired", accounts: [] })
      } else if (err instanceof NotLoggedIn) {
        await setStatus({ lastError: "not-logged-in" })
      } else {
        log("sync failed", err)
        await setStatus({ lastError: String(err && err.message ? err.message : err) })
      }
    } finally {
      syncing = false
    }
  }

  // The first look happens shortly after the page settles; after that on a
  // timer. A background tab's timers are slowed by the browser to about one
  // a minute, which is the cadence anyway.
  setTimeout(() => syncOnce("load"), 2500)
  setInterval(() => syncOnce("timer"), CFG.pollSeconds * 1000)

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "sync-now") {
      syncOnce(message.reason === "nudge" ? "timer" : "manual").then(() => sendResponse({ ok: true }))
      return true
    }
    return false
  })
})()
