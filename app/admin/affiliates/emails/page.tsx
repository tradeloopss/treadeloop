import { requireAdmin } from "@/lib/admin/guard"
import { emailConfigured } from "@/lib/email"
import { emailPreviews } from "@/lib/emails/affiliate-emails"
import { renderEmail } from "@/lib/emails/layout"
import { MAX_EMAIL_ATTEMPTS, recentEmailEvents, senderAddress } from "@/lib/emails/outbox"
import { AdminPageHeader, Panel, fmtAgo } from "@/components/admin/ui"
import { Empty, StatusBadge, TableShell, THead, tdClass, thClass } from "@/components/affiliate/ui"
import { EmailPreviews } from "@/components/admin/affiliates/email-previews"

// queued / sending read as "in progress"; the rest as themselves.
const BADGE: Record<string, string> = { sent: "paid", failed: "failed", queued: "pending", sending: "pending" }
const LABEL: Record<string, string> = { sent: "Sent", failed: "Failed", queued: "Retrying", sending: "Sending" }

export default async function AdminAffiliateEmailsPage() {
  await requireAdmin({ affiliates: ["view"] })
  const previews = emailPreviews().map((p) => ({ id: p.id, name: p.name, from: senderAddress(p.doc.sender), subject: p.doc.subject, preview: p.doc.preview, html: renderEmail(p.doc).html }))
  const events = await recentEmailEvents(40)

  return (
    <div>
      <AdminPageHeader title="Emails" description="What affiliates receive, and what was actually delivered. The previews use sample data and never send anything." />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {!emailConfigured() && <p className="rounded-lg bg-[var(--chart-4)]/10 px-3 py-2 text-sm text-[var(--chart-4)]">Email isn&apos;t set up on this deployment (RESEND_API_KEY is missing), so nothing is being sent.</p>}
        <Panel
          title="Templates"
          description={`Application emails come from ${senderAddress("affiliate")}; payout and payout-method emails from ${senderAddress("payments")}.`}
        >
          <EmailPreviews previews={previews} />
        </Panel>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Delivery log</h2>
            <p className="text-xs text-muted-foreground">Latest 40. Each event is emailed once; a delivery that fails is retried up to {MAX_EMAIL_ATTEMPTS} times, further apart each time.</p>
          </div>
          {events.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <Empty title="No emails sent yet">They appear here as applications are decided and payouts move.</Empty>
            </div>
          ) : (
            <TableShell>
              <THead>
                <tr>
                  <th className={thClass}>When</th>
                  <th className={thClass}>Email</th>
                  <th className={thClass}>To</th>
                  <th className={thClass}>From</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-end`}>Attempts</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtAgo(e.createdAt)}</td>
                    <td className={tdClass}>
                      {e.subject}
                      <span className="block font-mono text-xs text-muted-foreground">{e.key}</span>
                    </td>
                    <td className={`${tdClass} break-all`}>{e.recipient}</td>
                    <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{e.sender.replace(/^.*<|>$/g, "")}</td>
                    <td className={tdClass}>
                      <StatusBadge status={BADGE[e.status] ?? e.status} label={LABEL[e.status] ?? e.status} />
                      {e.lastError && e.status !== "sent" && <span className="mt-1 block max-w-64 text-xs text-[var(--loss)]">{e.lastError}</span>}
                    </td>
                    <td className={`${tdClass} text-end tabular-nums`}>{e.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </section>
      </div>
    </div>
  )
}
