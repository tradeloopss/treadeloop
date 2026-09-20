// The toolbar popup: is this browser paired, when did it last sync, and the
// two things a trader might need to do by hand — sync right now, or pair
// with a code when the pairing page couldn't be read.
;(async () => {
  const CFG = globalThis.TRADELOOP
  const storage = chrome.storage.local
  const $ = (id) => document.getElementById(id)

  const PROBLEMS = {
    unpaired: "This browser was unpaired from the journal.",
    "not-logged-in": "Log in to TradingView in the open tab, then sync again.",
  }

  function timeAgo(ms) {
    if (!ms) return "—"
    const seconds = Math.round((Date.now() - ms) / 1000)
    if (seconds < 60) return "just now"
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours} h ago`
    return new Date(ms).toLocaleDateString()
  }

  async function render() {
    const { pairing, status = {} } = await storage.get(["pairing", "status"])
    const paired = Boolean(pairing && pairing.token)
    $("unpaired").hidden = paired
    $("paired").hidden = !paired

    if (!paired) {
      const base = CFG.defaultBaseUrl
      $("open-pair").href = `${base}/extension/pair`
      if (!$("base").value) $("base").value = base
      const note = status.lastError === "unpaired" ? PROBLEMS.unpaired : ""
      $("unpaired-reason").textContent = note
      $("unpaired-reason").hidden = !note
      return
    }

    $("journal-host").textContent = new URL(pairing.baseUrl).host
    $("last-sync").textContent = timeAgo(status.lastSyncAt)
    const accounts = status.accounts || []
    $("accounts").textContent = accounts.length ? accounts.map((a) => a.name).join(", ") : "none seen yet"
    $("fills").textContent = String(status.totalFills || 0)
    $("open-tv").href = CFG.tradingviewUrl

    const problem = status.lastError ? PROBLEMS[status.lastError] || status.lastError : ""
    $("problem").textContent = problem
    $("problem").hidden = !problem

    const tabs = await chrome.tabs.query({ url: CFG.tradingviewMatches }).catch(() => [])
    $("hint").textContent =
      tabs.length === 0
        ? "Fills sync while TradingView is open in this browser. Open it and they'll be picked up."
        : `Watching ${tabs.length === 1 ? "1 TradingView tab" : `${tabs.length} TradingView tabs`} — new fills reach the journal within about a minute.`
  }

  $("sync-now").addEventListener("click", async () => {
    const button = $("sync-now")
    button.disabled = true
    button.textContent = "Syncing…"
    try {
      const answer = await chrome.runtime.sendMessage({ type: "sync-now" })
      if (!answer || answer.tabs === 0) {
        $("hint").textContent = "No TradingView tab is open — open one and it syncs on its own."
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
    } finally {
      button.disabled = false
      button.textContent = "Sync now"
      render()
    }
  })

  $("unpair").addEventListener("click", async () => {
    await storage.remove(["pairing", "acked", "status", "lastPollAt"])
    render()
  })

  $("code-form").addEventListener("submit", async (event) => {
    event.preventDefault()
    const token = $("code").value.trim()
    let baseUrl
    try {
      baseUrl = new URL($("base").value.trim()).origin
    } catch {
      $("code-error").textContent = "That address isn't a URL."
      $("code-error").hidden = false
      return
    }
    const query = new URLSearchParams({ version: CFG.version })
    let ok = false
    try {
      const response = await fetch(`${baseUrl}/api/tradingview/extension?${query}`, { headers: { Authorization: `Bearer ${token}` } })
      ok = response.ok
    } catch {
      ok = false
    }
    if (!ok) {
      $("code-error").textContent = "That code wasn't accepted — copy it again from the pairing page."
      $("code-error").hidden = false
      return
    }
    await storage.set({ pairing: { token, baseUrl, pairedAt: Date.now() }, acked: {}, status: { updatedAt: Date.now(), accounts: [] } })
    chrome.runtime.sendMessage({ type: "paired" }).catch(() => {})
    render()
  })

  chrome.storage.onChanged.addListener(() => render())
  render()
})()
