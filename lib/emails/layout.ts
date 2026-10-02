// The TradeLoop transactional email layout. One description of an email (an
// EmailDoc) renders to both the HTML and the plain-text part, so the two can
// never disagree. Pure: no database, no network, no environment beyond the
// site addresses — which is what lets every template be previewed and tested.
//
// The HTML is deliberately old-fashioned: tables, inline styles, system fonts,
// no external CSS, a bulletproof button. That is what renders the same in
// Gmail, Outlook, Apple Mail and Yahoo, on a desktop and on a phone, and stays
// readable with images blocked (the logo has alt text and sits next to the
// wordmark as text).

export type Sender = "affiliate" | "payments"
export type Tone = "success" | "info" | "warning" | "danger" | "neutral"

// A value that may be missing. Rows and sections with nothing to show are
// left out entirely — an email never prints "undefined".
type Maybe = string | null | undefined

export type Block =
  | { kind: "text"; lines: Maybe[] }
  | { kind: "info"; title?: string; rows: [string, Maybe][] }
  | { kind: "amount"; label: string; value: string; note?: Maybe }
  | { kind: "code"; label: string; value: Maybe }
  | { kind: "steps"; title: string; items: string[] }
  | { kind: "notice"; title?: string; lines: Maybe[] }
  | { kind: "warning"; title?: string; lines: Maybe[] }
  | { kind: "cta"; label: string; url: string }

export type EmailDoc = {
  template: string
  sender: Sender
  subject: string
  // the line an inbox shows after the subject
  preview: string
  badge: { label: string; tone: Tone }
  headline: string
  greeting: string
  intro: Maybe[]
  blocks: Block[]
  closing?: Maybe[]
  signature: string
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "https://app.tradeloop.pro").replace(/\/+$/, "")
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.tradeloop.pro").replace(/\/+$/, "")

// The affiliate portal's own address, when it has one (affiliate.tradeloop.pro).
const AFFILIATE_URL = (process.env.NEXT_PUBLIC_AFFILIATE_URL ?? "").replace(/\/+$/, "")

// A link into the product. Portal pages ("/affiliate/payouts") go to the
// portal's own address when there is one; everything else to the app.
export function appUrl(path = ""): string {
  if (AFFILIATE_URL && /^\/affiliate(?=\/|\?|#|$)/.test(path)) {
    const rest = path.slice("/affiliate".length)
    return `${AFFILIATE_URL}${rest.startsWith("/") ? rest : `/${rest}`}`
  }
  return `${APP_URL}${path}`
}
export const siteUrl = (path = "") => `${SITE_URL}${path}`

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

// Only our own https links ever go into an href.
const safeUrl = (url: string) => (/^https:\/\/[^\s"'<>]+$/i.test(url) ? url : APP_URL)

const present = (v: Maybe): v is string => typeof v === "string" && v.trim() !== ""
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const C = { page: "#f3f2f8", card: "#ffffff", text: "#1b1a27", muted: "#6b6880", faint: "#8f8ca3", border: "#e7e5f0", soft: "#f8f7fc", primary: "#6b52dd" }
const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  success: { fg: "#0f7a55", bg: "#e7f6ef", border: "#bfe6d5" },
  info: { fg: "#5a41cc", bg: "#efecfd", border: "#d9d2fa" },
  warning: { fg: "#a35a07", bg: "#fef4e4", border: "#f6dcae" },
  danger: { fg: "#b93226", bg: "#fdecea", border: "#f5c6c1" },
  neutral: { fg: "#4b4860", bg: "#f0eff5", border: "#dddbe8" },
}

// --- pieces (HTML) ------------------------------------------------------------

export const statusBadge = (label: string, tone: Tone) =>
  `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${TONES[tone].bg};color:${TONES[tone].fg};border:1px solid ${TONES[tone].border};font:700 11px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase">${esc(label)}</span>`

const para = (text: string, style = "") => `<p style="margin:0 0 14px;font:400 15px/1.6 ${FONT};color:${C.text};${style}">${esc(text).replace(/\n/g, "<br>")}</p>`

function infoCard(title: string | undefined, rows: [string, string][]): string {
  const body = rows
    .map(
      ([label, value], i) =>
        `<tr><td style="padding:11px 16px;${i ? `border-top:1px solid ${C.border};` : ""}font:400 13px/1.4 ${FONT};color:${C.muted};vertical-align:top;width:42%">${esc(label)}</td><td style="padding:11px 16px;${i ? `border-top:1px solid ${C.border};` : ""}font:600 13px/1.4 ${FONT};color:${C.text};text-align:right;word-break:break-word">${esc(value)}</td></tr>`
    )
    .join("")
  return `${title ? `<p style="margin:0 0 8px;font:700 11px/1.3 ${FONT};color:${C.faint};letter-spacing:.08em;text-transform:uppercase">${esc(title)}</p>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${C.border};border-radius:10px;border-collapse:separate;background:${C.card}">${body}</table>`
}

const amountCard = (label: string, value: string, note: Maybe) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${C.border};border-radius:10px;border-collapse:separate;background:${C.soft}"><tr><td style="padding:18px 16px;text-align:center"><p style="margin:0 0 6px;font:700 11px/1.3 ${FONT};color:${C.faint};letter-spacing:.08em;text-transform:uppercase">${esc(label)}</p><p style="margin:0;font:700 30px/1.15 ${FONT};color:${C.text};letter-spacing:-.01em">${esc(value)}</p>${present(note) ? `<p style="margin:6px 0 0;font:400 13px/1.4 ${FONT};color:${C.muted}">${esc(note)}</p>` : ""}</td></tr></table>`

const codeBox = (label: string, value: string) =>
  `<p style="margin:0 0 8px;font:700 11px/1.3 ${FONT};color:${C.faint};letter-spacing:.08em;text-transform:uppercase">${esc(label)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px dashed ${C.border};border-radius:10px;border-collapse:separate;background:${C.soft}"><tr><td style="padding:13px 16px;font:600 14px/1.45 'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;color:${C.text};word-break:break-all">${esc(value)}</td></tr></table>`

function callout(tone: Tone, title: string | undefined, lines: string[]): string {
  const t = TONES[tone]
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${t.border};border-radius:10px;border-collapse:separate;background:${t.bg}"><tr><td style="padding:14px 16px">${title ? `<p style="margin:0 0 6px;font:700 11px/1.3 ${FONT};color:${t.fg};letter-spacing:.08em;text-transform:uppercase">${esc(title)}</p>` : ""}${lines.map((l, i) => `<p style="margin:${i ? "6px" : "0"} 0 0;font:400 14px/1.55 ${FONT};color:${C.text}">${esc(l).replace(/\n/g, "<br>")}</p>`).join("")}</td></tr></table>`
}

const steps = (title: string, items: string[]) =>
  `<p style="margin:0 0 8px;font:700 11px/1.3 ${FONT};color:${C.faint};letter-spacing:.08em;text-transform:uppercase">${esc(title)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${items
    .map(
      (item, i) =>
        `<tr><td style="padding:5px 12px 5px 0;vertical-align:top;width:26px"><span style="display:inline-block;width:22px;height:22px;border-radius:999px;background:${TONES.info.bg};color:${TONES.info.fg};font:700 12px/22px ${FONT};text-align:center">${i + 1}</span></td><td style="padding:5px 0;font:400 14px/1.55 ${FONT};color:${C.text}">${esc(item)}</td></tr>`
    )
    .join("")}</table>`

// A button that is a button everywhere: a padded link in a coloured cell, so
// Outlook (which ignores border-radius and padding on <a>) still shows one.
const button = (label: string, url: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr><td bgcolor="${C.primary}" style="border-radius:9px;background:${C.primary}"><a href="${esc(safeUrl(url))}" target="_blank" style="display:inline-block;padding:12px 22px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:9px">${esc(label)}</a></td></tr></table>`

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "text":
      return b.lines.filter(present).map((l) => para(l)).join("")
    case "info": {
      const rows = b.rows.filter((r): r is [string, string] => present(r[1]))
      return rows.length ? infoCard(b.title, rows) : ""
    }
    case "amount":
      return amountCard(b.label, b.value, b.note)
    case "code":
      return present(b.value) ? codeBox(b.label, b.value) : ""
    case "steps":
      return b.items.length ? steps(b.title, b.items) : ""
    case "notice":
    case "warning": {
      const lines = b.lines.filter(present)
      return lines.length ? callout(b.kind === "warning" ? "warning" : "neutral", b.title, lines) : ""
    }
    case "cta":
      return button(b.label, b.url)
  }
}

function blockText(b: Block): string {
  switch (b.kind) {
    case "text":
      return b.lines.filter(present).join("\n\n")
    case "info": {
      const rows = b.rows.filter((r): r is [string, string] => present(r[1]))
      return rows.length ? `${b.title ? `${b.title.toUpperCase()}\n` : ""}${rows.map(([l, v]) => `${l}: ${v}`).join("\n")}` : ""
    }
    case "amount":
      return `${b.label.toUpperCase()}: ${b.value}${present(b.note) ? ` (${b.note})` : ""}`
    case "code":
      return present(b.value) ? `${b.label}: ${b.value}` : ""
    case "steps":
      return b.items.length ? `${b.title.toUpperCase()}\n${b.items.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : ""
    case "notice":
    case "warning": {
      const lines = b.lines.filter(present)
      return lines.length ? `${b.title ? `${b.title.toUpperCase()}\n` : ""}${lines.join("\n")}` : ""
    }
    case "cta":
      return `${b.label}: ${safeUrl(b.url)}`
  }
}

const FOOTER_LINKS: [string, string][] = [
  ["Affiliate Dashboard", appUrl("/affiliate")],
  ["Support", appUrl("/affiliate/support")],
  ["Payouts", appUrl("/affiliate/payouts")],
]
const LEGAL_LINKS: [string, string][] = [
  ["Manage Email Preferences", appUrl("/affiliate/settings")],
  ["Privacy Policy", siteUrl("/privacy")],
  ["Terms", siteUrl("/terms")],
]
const REASON = "You are receiving this email because you have an account or affiliate relationship with TradeLoop."

export const SENDER_NAMES: Record<Sender, string> = { affiliate: "TradeLoop Affiliates", payments: "TradeLoop Payments" }

// --- the whole email ----------------------------------------------------------

export function renderEmail(doc: EmailDoc): { html: string; text: string } {
  const year = new Date().getUTCFullYear()
  const link = ([label, url]: [string, string]) => `<a href="${esc(url)}" target="_blank" style="color:${C.muted};text-decoration:underline">${esc(label)}</a>`
  const body = [
    para(doc.greeting),
    ...doc.intro.filter(present).map((l) => para(l)),
    ...doc.blocks.map(blockHtml),
    ...(doc.closing ?? []).filter(present).map((l) => para(l)),
    `<p style="margin:18px 0 0;font:600 14px/1.5 ${FONT};color:${C.text}">— ${esc(doc.signature)}</p>`,
  ].join("")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(doc.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(doc.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px">
<tr><td style="padding:0 6px 16px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:10px"><img src="${esc(appUrl("/logo-mark.png"))}" width="30" height="30" alt="TradeLoop" style="display:block;border:0;outline:none;width:30px;height:30px"></td>
<td style="vertical-align:middle;font:700 17px/1 ${FONT};color:${C.text};letter-spacing:-.01em">TradeLoop</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:30px 28px 28px">
<div style="margin:0 0 16px">${statusBadge(doc.badge.label, doc.badge.tone)}</div>
<h1 style="margin:0 0 18px;font:700 24px/1.25 ${FONT};color:${C.text};letter-spacing:-.015em">${esc(doc.headline)}</h1>
${body}
</td></tr>
<tr><td style="padding:22px 12px 6px;text-align:center">
<p style="margin:0;font:700 14px/1.4 ${FONT};color:${C.text}">TradeLoop</p>
<p style="margin:2px 0 12px;font:400 13px/1.4 ${FONT};color:${C.muted}">Trading smarter. Journaling better.</p>
<p style="margin:0 0 12px;font:400 13px/1.6 ${FONT};color:${C.muted}">${FOOTER_LINKS.map(link).join(" &nbsp;·&nbsp; ")}</p>
<p style="margin:0 0 6px;font:400 12px/1.5 ${FONT};color:${C.faint}">© ${year} TradeLoop. All rights reserved.</p>
<p style="margin:0 0 10px;font:400 12px/1.5 ${FONT};color:${C.faint}">${esc(REASON)}</p>
<p style="margin:0;font:400 12px/1.6 ${FONT};color:${C.faint}">${LEGAL_LINKS.map(link).join(" &nbsp;·&nbsp; ")}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  const text = [
    `[${doc.badge.label.toUpperCase()}]`,
    doc.headline,
    doc.greeting,
    ...doc.intro.filter(present),
    ...doc.blocks.map(blockText).filter(Boolean),
    ...(doc.closing ?? []).filter(present),
    `— ${doc.signature}`,
    "--",
    "TradeLoop — Trading smarter. Journaling better.",
    FOOTER_LINKS.map(([l, u]) => `${l}: ${u}`).join("\n"),
    `© ${year} TradeLoop. All rights reserved.`,
    REASON,
    LEGAL_LINKS.map(([l, u]) => `${l}: ${u}`).join("\n"),
  ].join("\n\n")

  return { html, text }
}
