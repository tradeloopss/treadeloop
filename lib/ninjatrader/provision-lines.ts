// What the NinjaTrader worker hands TradeLoop Provision (the add-on on TradeLoop's own server) for one
// Tradovate login: one line, tabs between the fields, so the add-on needs no JSON library.
//
//   id  connection name  live|simulation  base64(username)  base64(password)  status
//
// The username and password are base64 so that nothing a trader types (a tab, a quote, a line break)
// can break the line or become another field.

// Which of Tradovate's two sides a login's accounts are on. A prop firm's accounts (evaluation and
// funded alike) are on Tradovate's simulation side; an account opened with Tradovate itself is live.
export function accountTypeOf(connectionKind: string): "live" | "simulation" {
  return connectionKind.trim().toLowerCase() === "tradovate" ? "live" : "simulation"
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")
const plain = (s: string) => s.replace(/[\t\r\n]/g, " ")

export function provisionLine(login: { id: number; name: string; kind: string; username: string; password: string; status: string }): string {
  return [String(login.id), plain(login.name), accountTypeOf(login.kind), b64(login.username), b64(login.password), plain(login.status)].join("\t")
}

// The same line, read back (the tests check the add-on's reading against this).
export function parseProvisionLine(line: string): { id: number; name: string; accountType: string; username: string; password: string; status: string } | null {
  const f = line.split("\t")
  if (f.length !== 6 || !/^\d+$/.test(f[0])) return null
  const text = (s: string) => Buffer.from(s, "base64").toString("utf8")
  return { id: Number(f[0]), name: f[1], accountType: f[2], username: text(f[3]), password: text(f[4]), status: f[5] }
}
