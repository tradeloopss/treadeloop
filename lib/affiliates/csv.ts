// CSV building for the affiliate exports. Pure, so it is unit-tested.

// A cell a spreadsheet would run as a formula (=, +, -, @, tab, CR) is
// prefixed with an apostrophe so opening an export can't execute anything.
export function csvCell(value: unknown): string {
  if (value == null) return ""
  let v = value instanceof Date ? value.toISOString() : String(value)
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "no-store",
    },
  })
}

// Exports are capped: a download is for a spreadsheet, not a data dump.
export const EXPORT_LIMIT = 5000
