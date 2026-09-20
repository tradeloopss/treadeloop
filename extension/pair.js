// Runs on TradeLoop. The pairing page renders a one-time pairing code into
// an element for this script to read; checking in with that code claims it,
// and from then on this browser posts fills to that TradeLoop with it.
//
// The script joins every TradeLoop page rather than only /extension/pair
// because a content script is injected on a full page load, and TradeLoop
// moves between pages without one — so the element is waited for wherever
// the trader happens to land.
;(() => {
  const CFG = globalThis.TRADELOOP
  const storage = chrome.storage.local
  const ELEMENT_ID = "tradeloop-pairing"
  let handled = null

  function browserLabel() {
    const data = navigator.userAgentData
    const brand = data?.brands?.find((b) => !/Not.A.Brand|Chromium/i.test(b.brand))?.brand
    const ua = navigator.userAgent
    const name = brand || (/Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Browser")
    const platform = data?.platform || (/Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "")
    return platform ? `${name} on ${platform}` : name
  }

  async function checkIn(candidate) {
    const query = new URLSearchParams({ browser: browserLabel(), version: CFG.version })
    const response = await fetch(`${candidate.baseUrl}/api/tradingview/extension?${query}`, {
      headers: { Authorization: `Bearer ${candidate.token}` },
    })
    return response.ok
  }

  // The page may still be hydrating when this runs, so the result is left on
  // the element as well as fired as an event.
  function announce(element) {
    element.dataset.paired = "true"
    document.dispatchEvent(new CustomEvent("tradeloop:paired"))
    chrome.runtime.sendMessage({ type: "paired" }).catch(() => {})
  }

  async function pair(element) {
    handled = element
    const token = element.dataset.token
    if (!token) return
    const baseUrl = location.origin

    // Already paired with this same journal and still welcome there? Then the
    // page just needs telling; the fresh code stays unclaimed for another
    // browser.
    const { pairing } = await storage.get("pairing")
    if (pairing && pairing.baseUrl === baseUrl && pairing.token !== token) {
      if (await checkIn(pairing)) {
        announce(element)
        return
      }
    }

    const fresh = { token, baseUrl, pairedAt: Date.now() }
    if (!(await checkIn(fresh))) return
    // A new pairing starts from nothing: every fill TradingView still lists is
    // sent once more and the journal keeps what it doesn't have.
    await storage.set({ pairing: fresh, acked: {}, status: { updatedAt: Date.now(), accounts: [] } })
    announce(element)
  }

  // Looked for on a timer rather than with a MutationObserver: TradeLoop is
  // a React app whose tree mutates constantly, and an observer over it would
  // run thousands of times for one element that appears once.
  function look() {
    const element = document.getElementById(ELEMENT_ID)
    if (element && handled !== element) pair(element)
  }
  look()
  setInterval(look, 1000)
})()
