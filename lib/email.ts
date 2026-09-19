// Transactional email through Resend's HTTP API (RESEND_API_KEY). The sender
// is EMAIL_FROM, whose domain has to be verified in Resend; without a key,
// sending fails with a clear error instead of pretending to succeed.

const FROM = process.env.EMAIL_FROM ?? "TradeLoop <noreply@tradeloop.pro>"
// Overridable for tests (a local catcher) or a proxy in front of Resend.
const ENDPOINT = process.env.RESEND_API_URL ?? "https://api.resend.com/emails"

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function sendEmail({ to, subject, text, html }: { to: string; subject: string; text: string; html?: string }) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("Email isn't set up on this deployment (RESEND_API_KEY is missing).")

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html: html ?? textToHtml(text) }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    let message = body
    try {
      message = JSON.parse(body).message ?? body
    } catch {}
    throw new Error(`Email wasn't sent (Resend ${res.status}): ${message}`.slice(0, 300))
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

// Plain paragraphs with links made clickable — enough for these short notices.
function textToHtml(text: string) {
  const body = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6b52dd">$1</a>')}</p>`)
    .join("")
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f1d2e;max-width:520px">${body}<p style="margin:24px 0 0;color:#8b8799;font-size:13px">— TradeLoop</p></div>`
}
