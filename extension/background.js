// The service worker does little: the TradingView tabs do the syncing
// themselves. It relays "sync now" from the popup or the pairing page to
// those tabs, keeps the toolbar badge in step with the last sync, and nudges
// the tabs once a minute so a throttled background tab still gets its turn.
importScripts("config.js")

const CFG = globalThis.TRADELOOP

// "manual" makes every tab look right away (the popup's button); "nudge"
// lets the tabs keep their one-poll-per-round arrangement.
async function nudgeTradingViewTabs(reason) {
  let tabs = []
  try {
    tabs = await chrome.tabs.query({ url: CFG.tradingviewMatches })
  } catch {
    return 0
  }
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: "sync-now", reason }).catch(() => {})
  }
  return tabs.length
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && (message.type === "sync-now" || message.type === "paired")) {
    nudgeTradingViewTabs("manual").then((count) => sendResponse({ tabs: count }))
    return true
  }
  return false
})

async function refreshBadge() {
  const { pairing, status } = await chrome.storage.local.get(["pairing", "status"])
  const problem = !pairing || (status && status.lastError)
  await chrome.action.setBadgeText({ text: problem ? "!" : "" })
  await chrome.action.setBadgeBackgroundColor({ color: !pairing ? "#6b7280" : "#dc2626" })
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.status || changes.pairing) refreshBadge()
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tradeloop-nudge", { periodInMinutes: 1 })
  refreshBadge()
})
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("tradeloop-nudge", { periodInMinutes: 1 })
  refreshBadge()
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tradeloop-nudge") nudgeTradingViewTabs("nudge")
})
