import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { payoutDetail } from "@/lib/affiliates/admin-queries"
import { PAYOUT_STATUS_LABELS, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { payoutEvents, payoutTransactions, trackPayout } from "@/lib/affiliates/payouts"
import { getPayoutSettings } from "@/lib/affiliates/program"
import { providerFor } from "@/lib/affiliates/providers"
import { explorerTxUrl, maskTxHash } from "@/lib/affiliates/tron"
import { methodLabel, money } from "@/lib/affiliates/types"
import { AdminPageHeader, Panel, fmtDateTime } from "@/components/admin/ui"
import { FieldRow, StatusBadge, TableShell, THead, tdClass, thClass } from "@/components/affiliate/ui"
import { PayoutAdminActions } from "@/components/admin/affiliates/payout-admin"

const EVENT_LABELS: Record<string, string> = {
  "payout.requested": "Requested by the affiliate",
  "payout.auto_created": "Created automatically",
  "payout.approved": "Approved",
  "payout.queued": "Queued",
  "payout.processing": "Marked as processing",
  "payout.transaction_submitted": "Transaction submitted",
  "payout.transaction_replaced": "Transaction hash replaced",
  "payout.submitted": "Submitted",
  "payout.confirming": "Seen on-chain, waiting for final confirmation",
  "payout.confirmed": "Confirmed on-chain",
  "payout.paid": "Completed",
  "payout.marked_paid": "Marked as paid",
  "payout.failed": "Failed",
  "payout.retry_required": "Attempt failed — retry required",
  "payout.retried": "Retried",
  "payout.on_hold": "Placed on hold",
  "payout.released": "Hold released",
  "payout.rejected": "Rejected",
  "payout.cancelled": "Cancelled",
  "payout.reversed": "Reversed",
}
const PROVIDERS: Record<string, string> = { manual: "Manual (sent by hand)", tron_manual: "Manual transfer, verified on the TRON network", stripe: "Stripe Connect" }
const ACTORS: Record<string, string> = { affiliate: "Affiliate", admin: "Admin", system: "System" }

export default async function AdminAffiliatePayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  // A payout that is waiting on the chain is checked before it is shown.
  await trackPayout(id).catch(() => null)
  const [p, events, transactions, settings] = await Promise.all([payoutDetail(id), payoutEvents(id), payoutTransactions(id), getPayoutSettings()])
  if (!p) notFound()
  const name = `${p.firstName} ${p.lastName}`.trim()
  const link = explorerTxUrl(p.network, p.transactionHash)
  const crypto = !!p.asset

  return (
    <div>
      <AdminPageHeader
        title={`Payout PO-${p.id}`}
        description={`${money(p.amount)} to ${name} · ${p.mode === "automatic" ? "created automatically" : "requested by the affiliate"}`}
        action={
          <Link href="/admin/affiliates/payouts" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> All payouts
          </Link>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {settings.paused && (
          <p role="status" className="rounded-lg border border-[var(--loss)]/50 bg-[var(--loss)]/6 px-4 py-3 text-sm">
            <span className="font-semibold">All payouts are paused.</span> This payout can&apos;t be approved or sent until payouts are resumed.
          </p>
        )}
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Payout" className="xl:col-span-2" action={<StatusBadge status={p.status} label={PAYOUT_STATUS_LABELS[p.status as PayoutStatus]} />}>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <div className="divide-y">
                <FieldRow label="Payout ID">
                  <span className="font-mono">PO-{p.id}</span>
                </FieldRow>
                <FieldRow label="Affiliate">
                  <Link href={`/admin/affiliates/${p.affiliateId}`} className="text-primary hover:underline">
                    {name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{p.email}</span>
                </FieldRow>
                <FieldRow label="Amount">
                  <span className="tabular-nums">{money(p.amount)}</span>
                </FieldRow>
                <FieldRow label="Fee">
                  <span className="tabular-nums">{p.fee > 0 ? money(p.fee) : "None"}</span>
                </FieldRow>
                <FieldRow label="Net">
                  <span className="tabular-nums font-semibold">
                    {money(p.net)}
                    {crypto ? " USDT" : ""}
                  </span>
                </FieldRow>
                <FieldRow label="Method">{methodLabel(p.methodType)}</FieldRow>
                <FieldRow label={crypto ? "Wallet" : "Destination"} hint="Masked. The full details are shown, and logged, when you pay.">
                  <span className="font-mono text-xs">{p.methodLabel}</span>
                </FieldRow>
              </div>
              <div className="divide-y">
                {crypto && (
                  <>
                    <FieldRow label="Asset · network">
                      {p.asset} · {p.network} (TRC-20)
                    </FieldRow>
                    <FieldRow label="Transaction">
                      {p.transactionHash ? (
                        link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                            {maskTxHash(p.transactionHash)} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          <span className="font-mono text-xs">{maskTxHash(p.transactionHash)}</span>
                        )
                      ) : (
                        "Not submitted yet"
                      )}
                    </FieldRow>
                  </>
                )}
                <FieldRow label="Provider">{PROVIDERS[p.provider] ?? p.provider}</FieldRow>
                {p.providerRef && (
                  <FieldRow label="Reference">
                    <span className="break-all font-mono text-xs">{p.providerRef}</span>
                  </FieldRow>
                )}
                <FieldRow label="Created">{fmtDateTime(p.requestedAt)}</FieldRow>
                <FieldRow label="Approved">{fmtDateTime(p.approvedAt)}</FieldRow>
                <FieldRow label="Submitted">{fmtDateTime(p.submittedAt)}</FieldRow>
                <FieldRow label="Completed">{fmtDateTime(p.completedAt)}</FieldRow>
                {p.attempts > 0 && <FieldRow label="Attempts">{p.attempts}</FieldRow>}
              </div>
            </div>
            {p.failureReason && <p className="mt-4 rounded-lg bg-[var(--loss)]/8 px-3 py-2 text-sm text-[var(--loss)]">{p.failureReason}</p>}
            {p.note && <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Note: {p.note}</p>}
            {(p.fraudLock || p.payoutHold || p.affiliateStatus !== "approved") && (
              <p className="mt-3 rounded-lg bg-[var(--chart-4)]/10 px-3 py-2 text-sm text-[var(--chart-4)]">
                {p.affiliateStatus !== "approved" ? `This affiliate's account is ${p.affiliateStatus}.` : p.fraudLock ? "This affiliate has a fraud lock — review before paying." : "This affiliate has a payout hold."}
              </p>
            )}
          </Panel>

          <Panel title="Actions" description="Only what this payout's state allows.">
            {canManage ? (
              <div className="flex flex-col gap-3">
                <div className="[&>div]:justify-start">
                  <PayoutAdminActions paused={settings.paused} payout={{ id: p.id, status: p.status, methodType: p.methodType, amount: p.amount, net: p.net, fee: p.fee, asset: p.asset, name, hasHash: !!p.transactionHash, automated: providerFor(p.methodType).automated }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {["paid", "failed", "cancelled", "rejected", "reversed"].includes(p.status) && !(p.status === "paid" && !crypto)
                    ? "This payout is finished. Nothing more can be done to it."
                    : crypto
                      ? "A crypto payout is completed by the TRON network, not by hand: submit the transaction hash and it finishes once a matching USDT transfer is irreversible."
                      : "Send the money, then record the result. Failing, rejecting or cancelling puts the amount back in the affiliate's available balance."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">You have view-only access to the affiliate program.</p>
            )}
          </Panel>
        </div>

        {transactions.length > 0 && (
          <Panel title="Transactions" description="Every attempt to move the money for this payout.">
            <TableShell className="border-0">
              <THead>
                <tr>
                  <th className={thClass}>Submitted</th>
                  <th className={thClass}>Provider</th>
                  <th className={thClass}>Transaction</th>
                  <th className={`${thClass} text-end`}>Amount</th>
                  <th className={thClass}>Destination</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Confirmed</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {transactions.map((t) => {
                  const url = explorerTxUrl(t.network, t.transactionHash)
                  const ref = t.transactionHash ? maskTxHash(t.transactionHash) : (t.providerTransactionId ?? "—")
                  return (
                    <tr key={t.id}>
                      <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(t.submittedAt ?? t.createdAt)}</td>
                      <td className={tdClass}>{PROVIDERS[t.provider] ?? t.provider}</td>
                      <td className={`${tdClass} font-mono text-xs`}>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            {ref} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          ref
                        )}
                      </td>
                      <td className={`${tdClass} text-end tabular-nums`}>
                        {money(t.amount)}
                        {t.asset ? ` ${t.asset}` : ""}
                      </td>
                      <td className={`${tdClass} font-mono text-xs`}>{t.destination}</td>
                      <td className={tdClass}>
                        <StatusBadge status={t.status === "confirmed" ? "paid" : t.status === "not_found" || t.status === "replaced" ? "disabled" : t.status} label={t.status.replace("_", " ")} />
                        {t.failureReason && <span className="mt-1 block max-w-64 text-xs text-[var(--loss)]">{t.failureReason}</span>}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(t.confirmedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </TableShell>
          </Panel>
        )}

        <Panel title="History" description="Everything that happened to this payout, newest first.">
          <ol className="space-y-3 border-s ps-4">
            {events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                <span className="font-medium">{EVENT_LABELS[e.action] ?? e.action}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {ACTORS[e.actorType] ?? e.actorType} · {fmtDateTime(e.createdAt)}
                </span>
                {e.reason && <span className="block text-xs text-muted-foreground">{e.reason}</span>}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  )
}
