import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_PANEL_WIDGETS, PANEL_WIDGETS, WIDGET_BY_ID, sanitizeLayout } from "@/lib/dashboard-widgets"

// A dashboard layout is made only of widgets the catalogue lists. The full
// calendar is one a trader can add; it is not in the layout nobody has edited,
// because its figures are only sent to a dashboard that shows it.

test("the full calendar is a widget a trader can add, and is not in the default layout", () => {
  const calendar = WIDGET_BY_ID.monthCalendar
  assert.deepEqual([calendar?.label, calendar?.section, calendar?.span], ["Full Calendar", "panel", 3])
  assert.ok(PANEL_WIDGETS.some((w) => w.id === "monthCalendar"))
  assert.equal(DEFAULT_PANEL_WIDGETS.includes("monthCalendar"), false)
})

test("a saved layout keeps the full calendar where the trader put it, and still drops what the catalogue doesn't know", () => {
  const layout = sanitizeLayout(["balance", "monthCalendar", "nope"], ["monthCalendar", "weekCalendar", "monthCalendar", "balance", "gone", 7])
  // a panel in the top row, a tile among the panels, an unknown id and a repeat are all dropped
  assert.deepEqual(layout, { stats: ["balance"], panels: ["monthCalendar", "weekCalendar"] })
})
