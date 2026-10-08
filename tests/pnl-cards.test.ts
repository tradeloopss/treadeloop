import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_VISIBILITY,
  PERIOD_PNL,
  VISIBILITY_FIELDS,
  accountLabel,
  cardFileName,
  cardStats,
  cardSubtitle,
  certificateRows,
  cleanDesign,
  cleanLayout,
  cleanPeriod,
  cleanPrivacy,
  cleanVisibility,
  defaultVisibility,
  effectiveVisibility,
  layoutSupports,
  publicCard,
  redactCard,
  resolveCardPeriod,
  xShareUrl,
  type PnlCardData,
  type PnlCardLayout,
  type PnlCardVisibility,
  type VisibilityKey,
} from "@/lib/pnl-cards/model"

// PNL Cards: what is switched off is not on the card, in any layout, for
// anyone; an account number is never on one in full; and every figure is
// worked out from real trades or not shown.

const ALL_ON = Object.fromEntries(VISIBILITY_FIELDS.map((f) => [f.key, true])) as PnlCardVisibility
const ALL_OFF = Object.fromEntries(VISIBILITY_FIELDS.map((f) => [f.key, false])) as PnlCardVisibility
const only = (...keys: VisibilityKey[]): PnlCardVisibility => ({ ...ALL_OFF, ...Object.fromEntries(keys.map((k) => [k, true])) })
const without = (...keys: VisibilityKey[]): PnlCardVisibility => ({ ...ALL_ON, ...Object.fromEntries(keys.map((k) => [k, false])) })

// figures no two of which are alike, so that one found where it should not be is known for what it is
const card: PnlCardData = {
  scopeLabel: "Copy group “Gold”",
  currency: "USD",
  profit: 8420.5,
  curve: [0, 1200, 900, 8420.5],
  balance: 103420,
  accountCount: 4,
  accounts: [
    { label: "MT5 •••4821", balance: 50000, pnl: 4230 },
    { label: "MT4 •••7312", balance: 18000, pnl: 1280 },
  ],
  trader: { name: "Alex Carter", image: "https://img.example/alex.png", pro: true },
  period: { key: "week", label: "Oct 5 — Oct 8, 2026" },
  stats: { trades: 37, winRate: 68.4, averageTrade: 227.58, bestTrade: 1284, worstTrade: -420 },
  exportedAt: "2026-10-08T14:00:00.000Z",
}

test("a new card shows what a trader would share and nothing more personal", () => {
  assert.deepEqual(DEFAULT_VISIBILITY, { profit: true, balance: true, totalAccounts: true, accountNames: true, accountPnl: true, traderName: true, traderPhoto: false, tradeLoopLogo: true, qrCode: true, date: true, tradingPeriod: false, winRate: false, numberOfTrades: false, averageTrade: false, bestTrade: false, worstTrade: false })
  // sixteen switches, and not one of them is about a firm, a code or a promotion
  assert.equal(VISIBILITY_FIELDS.length, 16)
  assert.equal(VISIBILITY_FIELDS.some((f) => /firm|promo|code\b|referral/i.test(f.label) && f.key !== "qrCode"), false)
})

test("every switch: on, the thing is on the card; off, it is not anywhere in it", () => {
  const shown = (v: PnlCardVisibility) => redactCard(card, v, "desktop")
  const text = (v: PnlCardVisibility) => JSON.stringify(shown(v))
  // what each switch governs, as it appears in the card's own data
  const marks: [VisibilityKey, string[]][] = [
    ["profit", ["8420.5", "1200"]],
    ["balance", ["103420", "50000", "18000"]],
    ["totalAccounts", ['"accountCount":4']],
    ["accountNames", ["•••4821", "•••7312"]],
    ["accountPnl", ["4230", "1280"]],
    ["traderName", ["Alex Carter"]],
    ["traderPhoto", ["alex.png"]],
    ["date", ["2026-10-08T14"]],
    ["tradingPeriod", ["Oct 5"]],
    ["winRate", ["68.4"]],
    ["numberOfTrades", ['"trades":37']],
    ["averageTrade", ["227.58"]],
    ["bestTrade", ["1284"]],
    ["worstTrade", ["-420"]],
  ]
  for (const [key, signs] of marks) {
    for (const sign of signs) {
      assert.equal(text(ALL_ON).includes(sign), true, `${key} on: ${sign} is on the card`)
      assert.equal(text(without(key)).includes(sign), false, `${key} off: ${sign} is not`)
    }
  }
  // profit off takes its line with it: the line is the profit, drawn
  assert.deepEqual([shown(without("profit")).profit, shown(without("profit")).curve], [null, null])
  // a name hidden hides the Pro mark that goes with it; a photo can stand without the name
  assert.deepEqual(shown(without("traderName")).trader, { name: null, image: "https://img.example/alex.png", pro: false })
  // the table goes when none of its columns is left, and stays (unnamed) while one is
  assert.deepEqual(shown(without("accountNames", "balance", "accountPnl")).accounts, [])
  assert.deepEqual(shown(only("accountPnl")).accounts, [{ label: null, balance: null, pnl: 4230 }, { label: null, balance: null, pnl: 1280 }])
  // everything off: a card with nothing of the trader's on it
  assert.deepEqual(shown(ALL_OFF), { scopeLabel: card.scopeLabel, currency: "USD", profit: null, curve: null, balance: null, accountCount: null, accounts: [], trader: { name: null, image: null, pro: false }, period: null, stats: { trades: null, winRate: null, averageTrade: null, bestTrade: null, worstTrade: null }, exportedAt: null })
  // and taking out twice is taking out once
  assert.deepEqual(redactCard(shown(without("balance")), without("balance"), "desktop"), shown(without("balance")))
})

test("the PNL only card is the profit and who made it: nothing about accounts fits on it, whatever is switched on", () => {
  const shown = redactCard(card, ALL_ON, "pnl-only")
  assert.deepEqual([shown.profit, shown.trader.name, shown.period?.label, shown.exportedAt != null], [8420.5, "Alex Carter", "Oct 5 — Oct 8, 2026", true])
  assert.deepEqual([shown.balance, shown.accountCount, shown.accounts, shown.stats], [null, null, [], { trades: null, winRate: null, averageTrade: null, bestTrade: null, worstTrade: null }])
  assert.deepEqual(VISIBILITY_FIELDS.filter((f) => layoutSupports("pnl-only", f.key)).map((f) => f.key), ["profit", "traderName", "traderPhoto", "tradeLoopLogo", "qrCode", "date", "tradingPeriod"])
  assert.equal(VISIBILITY_FIELDS.every((f) => layoutSupports("desktop", f.key) && layoutSupports("mobile", f.key)), true)
  // the switches themselves are kept as they were: going back to Desktop brings the accounts back
  assert.deepEqual([effectiveVisibility(ALL_ON, "pnl-only").balance, effectiveVisibility(ALL_ON, "mobile").balance], [false, true])
})

test("what anyone else is given is the card already taken apart: nothing hidden travels with it", () => {
  const shared = publicCard({ token: "tok", layout: "desktop", visibility: only("profit", "tradeLoopLogo", "qrCode"), data: card })
  const sent = JSON.stringify(shared)
  for (const hidden of ["103420", "50000", "•••4821", "4230", "Alex Carter", "alex.png", "68.4", "1284", "-420", "Oct 5"]) assert.equal(sent.includes(hidden), false, hidden)
  assert.deepEqual([shared.data.profit, shared.visibility.qrCode, shared.visibility.balance], [8420.5, true, false])
  // only the card: no id of the card, the trader or an account
  assert.deepEqual(Object.keys(shared).sort(), ["data", "design", "layout", "token", "visibility"])
  // and a card that never said which broker an account is with does not start to by being shared
  assert.deepEqual(publicCard({ token: "tok", layout: "desktop", visibility: ALL_ON, data: card }).data.accounts[0], { label: "MT5 •••4821", balance: 50000, pnl: 4230 })
})

test("a certificate is the same card in its own look: its own defaults, and its brokers go where the account names go", () => {
  assert.deepEqual([cleanDesign("certificate"), cleanDesign("card"), cleanDesign("poster"), cleanDesign(undefined)], ["certificate", "card", "card", "card"])
  // what the certificate has always shown: the P&L, who made it (photo and all), the period, where it came from. Not the balance.
  const d = defaultVisibility("certificate")
  assert.deepEqual([d.profit, d.balance, d.traderName, d.traderPhoto, d.tradingPeriod, d.totalAccounts, d.accountNames, d.accountPnl, d.qrCode, d.date, d.winRate, d.bestTrade], [true, false, true, true, true, true, true, true, true, true, false, false])
  assert.deepEqual(defaultVisibility("card"), DEFAULT_VISIBILITY)
  // each card its own switches: changing one card's does not change the next one's
  defaultVisibility("certificate").balance = true
  assert.equal(defaultVisibility("certificate").balance, false)

  const cert: PnlCardData = { ...card, accounts: [{ label: "MT5 •••4821", balance: 50000, pnl: 4230, broker: "Exness" }, { label: "Rithmic •••5485", balance: 18000, pnl: 1280, broker: "Apex Trader Funding" }] }
  const text = (v: PnlCardVisibility, layout: PnlCardLayout = "mobile") => JSON.stringify(redactCard(cert, v, layout))
  for (const broker of ["Exness", "Apex Trader Funding"]) {
    assert.equal(text(ALL_ON).includes(broker), true, `${broker} is on the certificate`)
    assert.equal(text(without("accountNames")).includes(broker), false, `names off: ${broker} is not`)
    assert.equal(text(ALL_ON, "pnl-only").includes(broker), false, `PNL only: ${broker} is not`)
    assert.equal(JSON.stringify(publicCard({ token: "tok", design: "certificate", layout: "desktop", visibility: without("accountNames"), data: cert })).includes(broker), false)
  }
  assert.deepEqual([publicCard({ token: "tok", design: "certificate", layout: "mobile", visibility: ALL_ON, data: cert }).design, publicCard({ token: "tok", layout: "mobile", visibility: ALL_ON, data: cert }).design], ["certificate", "card"])
  assert.deepEqual([PERIOD_PNL.today, PERIOD_PNL.week.label, PERIOD_PNL.month.kind, PERIOD_PNL.all.label], [{ kind: "Daily", label: "Daily P&L" }, "Weekly P&L", "Monthly", "All-time P&L"])
  assert.equal(cardFileName("2026-10-08T14:00:00.000Z", "certificate"), "tradeloop-pnl-certificate-2026-10-08.png")
})

test("a certificate says where the result came from: broker by broker, the one account, or counted off when names are hidden", () => {
  const a = (label: string | null, pnl: number | null, broker?: string | null) => ({ label, balance: null, pnl, ...(broker !== undefined ? { broker } : {}) })
  // several accounts: one row a broker, the accounts of each added up, the best first; no broker is "Other"
  assert.deepEqual(certificateRows([a("MT5 •••0001", 100.1, "Exness"), a("MT5 •••0002", -40, "FTMO"), a("MT5 •••0003", 200.2, " Exness "), a("Manual", 5, null)]), [
    { name: "Exness", broker: "Exness", pnl: 300.3 },
    { name: "Other", broker: null, pnl: 5 },
    { name: "FTMO", broker: "FTMO", pnl: -40 },
  ])
  // one account: that account, by its masked name, with its broker's mark
  assert.deepEqual(certificateRows([a("MT5 •••4821", 4230, "Exness")]), [{ name: "MT5 •••4821", broker: "Exness", pnl: 4230 }])
  assert.deepEqual(certificateRows([a("Swing account", -12, null)]), [{ name: "Swing account", broker: null, pnl: -12 }])
  // names switched off (the label and the broker both gone): nothing names them
  const hidden = redactCard({ ...card, accounts: [a("MT5 •••0001", 100, "Exness"), a("MT5 •••0002", -40, "FTMO")] }, without("accountNames"), "mobile").accounts
  assert.deepEqual(certificateRows(hidden), [{ name: "Account 1", broker: null, pnl: 100 }, { name: "Account 2", broker: null, pnl: -40 }])
  // the P&L of each switched off: who, without how much
  assert.deepEqual(certificateRows(redactCard({ ...card, accounts: [a("MT5 •••0001", 100, "Exness"), a("MT5 •••0002", -40, "Exness")] }, without("accountPnl"), "mobile").accounts), [{ name: "Exness", broker: "Exness", pnl: null }])
  assert.deepEqual(certificateRows([]), [])
})

test("an account is named by its platform and its last four digits, never its number", () => {
  assert.equal(accountLabel({ platform: "mt5", login: "1200520315", name: "Just Global Markets Ltd. - 1200520315" }), "MT5 •••0315")
  assert.equal(accountLabel({ platform: "mt4", login: "16494751", name: "x" }), "MT4 •••4751")
  assert.equal(accountLabel({ platform: "rithmic", login: "APEX-3215485", name: "x" }), "Rithmic •••5485")
  // no login to go by: the trader's own name for it, with any account number typed into it masked
  assert.equal(accountLabel({ platform: null, login: null, name: "Funded 2002131075" }), "Funded •••1075")
  assert.equal(accountLabel({ platform: null, login: null, name: "Swing account" }), "Swing account")
  for (const a of [{ platform: "mt5", login: "1200520315", name: "Just Global Markets Ltd. - 1200520315" }, { platform: null, login: null, name: "Acct 2002131075 live" }]) assert.equal(/\d{5,}/.test(accountLabel(a)), false)
})

test("the figures come from the trades, and where there are none there is no figure", () => {
  assert.deepEqual(cardStats([]), { profit: 0, curve: null, trades: 0, winRate: null, averageTrade: null, bestTrade: null, worstTrade: null })
  const s = cardStats([100, -40, 250.5, -10.5, 0])
  assert.deepEqual([s.profit, s.trades, s.winRate, s.averageTrade, s.bestTrade, s.worstTrade], [300, 5, 40, 60, 250.5, -40])
  // the line is the profit building up, and ends on it
  assert.deepEqual(s.curve, [0, 100, 60, 310.5, 300, 300])
  // one trade is a figure, not a line
  assert.deepEqual([cardStats([75]).curve, cardStats([75]).winRate, cardStats([-75]).winRate], [null, 100, 0])
  // a long history is thinned to a line of at most forty points that still ends on the profit
  const many = cardStats(Array.from({ length: 500 }, (_, i) => (i % 3 === 0 ? -5 : 7)))
  assert.equal(many.curve!.length <= 42, true)
  assert.equal(many.curve![many.curve!.length - 1], many.profit)
})

test("a period is the trader's own days", () => {
  assert.deepEqual(resolveCardPeriod("today", "2026-10-08"), { key: "today", start: "2026-10-08", end: "2026-10-08", label: "Oct 8, 2026" })
  // Thursday: the week began on Monday the 5th
  assert.deepEqual(resolveCardPeriod("week", "2026-10-08"), { key: "week", start: "2026-10-05", end: "2026-10-08", label: "Oct 5 — Oct 8, 2026" })
  assert.deepEqual(resolveCardPeriod("month", "2026-10-08"), { key: "month", start: "2026-10-01", end: "2026-10-08", label: "Oct 1 — Oct 8, 2026" })
  // a Monday, and the first of a month, are a period of one day
  assert.equal(resolveCardPeriod("week", "2026-10-05").label, "Oct 5, 2026")
  assert.equal(resolveCardPeriod("month", "2026-10-01").label, "Oct 1, 2026")
  assert.deepEqual([resolveCardPeriod("all", "2026-10-08").start, resolveCardPeriod("all", "2026-10-08").label], [null, "All time, to Oct 8, 2026"])
})

test("what comes from the page is cleaned before it is believed", () => {
  assert.deepEqual([cleanLayout("mobile"), cleanLayout("pnl-only"), cleanLayout("poster"), cleanLayout(undefined)], ["mobile", "pnl-only", "desktop", "desktop"])
  assert.deepEqual([cleanPeriod("month"), cleanPeriod("decade"), cleanPrivacy("public"), cleanPrivacy("everyone"), cleanPrivacy(undefined)], ["month", "today", "public", "private", "private"])
  // only the known switches, only real booleans; the rest keeps what it had
  const v = cleanVisibility({ profit: false, balance: "no", promoCode: true, firmLogo: true, winRate: true }, DEFAULT_VISIBILITY)
  assert.deepEqual([v.profit, v.balance, v.winRate, "promoCode" in v, "firmLogo" in v], [false, true, true, false, false])
  assert.deepEqual(cleanVisibility(null), DEFAULT_VISIBILITY)
})

test("the words that go with a card say no more than the card does", () => {
  assert.equal(cardSubtitle(card), "Copy group “Gold” • +$8,420.50 • Exported at Oct 8")
  const url = "https://app.tradeloop.pro/pnl/tok"
  const withProfit = decodeURIComponent(xShareUrl({ data: card, visibility: ALL_ON, layout: "desktop" }, url))
  assert.equal(withProfit, `https://x.com/intent/post?text=My TradeLoop trading results:\n+$8,420.50 PNL&url=${url}`)
  // profit switched off: the post does not say it either
  const hidden = decodeURIComponent(xShareUrl({ data: card, visibility: without("profit"), layout: "desktop" }, url))
  assert.equal(hidden.includes("8,420"), false)
  assert.match(hidden, /My TradeLoop trading results&url=/)
  // a loss is said as one
  assert.match(decodeURIComponent(xShareUrl({ data: { ...card, profit: -420 }, visibility: ALL_ON, layout: "pnl-only" }, url)), /−\$420\.00 PNL/)
  assert.equal(cardFileName("2026-10-08T14:00:00.000Z"), "tradeloop-pnl-card-2026-10-08.png")
})
