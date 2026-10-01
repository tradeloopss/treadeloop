import Link from "next/link"
import { Banknote, Download, ExternalLink } from "lucide-react"
import { requireAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { payoutsPage } from "@/lib/affiliates/admin-queries"
import { PAYOUT_STATUS_LABELS, type PayoutGroup, type PayoutStatus } from "@/lib/affiliates/payout-engine"
import { trackPayouts } from "@/lib/affiliates/payouts"
import { getPayoutSettings } from "@/lib/affiliates/program"
import { HOT_PROVIDER, hotWalletReady, providerByName } from "@/lib/affiliates/providers"
import { PAGE_SIZE } from "@/lib/affiliates/queries"
import { explorerTxUrl, maskTxHash } from "@/lib/affiliates/tron"
import { PAYOUT_METHOD_LABELS, PAYOUT_METHOD_TYPES, methodLabel, money } from "@/lib/affiliates/types"
import { AdminPageHeader, FilterSelect, Pager } from "@/components/admin/ui"
import { Empty, StatusBadge, TableShell, THead, fmtDay, linkButtonClass, tdClass, thClass } from "@/components/affiliate/ui"
import { PayoutAdminActions } from "@/components/admin/affiliates/payout-admin"

const TABS: [PayoutGroup, string][] = [["pending", "Pending"], ["processing", "Processing"], ["completed", "Completed"], ["failed", "Failed"], ["on_hold", "On Hold"]]
const EMPTY: Record<PayoutGroup, [string, string]> = {
  pending: ["Nothing waiting for approval", "Payout requests and automatic payouts that need approving show up here."],
  processing: ["Nothing in the queue", "Approved payouts wait here until they're sent and confirmed."],
  completed: ["No completed payouts yet", ""],
  failed: ["No failed, rejected or cancelled payouts", ""],
  on_hold: ["Nothing on hold", ""],
}
const inputClass = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null)
const amount = (v?: string) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null)

type Search = { tab?: string; q?: string; method?: string; mode?: string; from?: string; to?: string; min?: string; max?: string; page?: string }

export default async function AdminAffiliatePayoutsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await requireAdmin({ affiliates: ["view"] })
  const canManage = roleCan(admin.role, { affiliates: ["manage"] })
  const sp = await searchParams
  const tab = (TABS.find(([v]) => v === sp.tab)?.[0] ?? "pending") as PayoutGroup
  // Payouts with a transaction that isn't final are followed up before the list is read.
  await trackPayouts({ olderThanSeconds: 45, limit: 4 }).catch(() => null)
  const to = day(sp.to)
  const filters = {
    group: tab,
    q: sp.q?.trim().slice(0, 80) || undefined,
    method: (PAYOUT_METHOD_TYPES as readonly string[]).includes(sp.method ?? "") ? sp.method : undefined,
    mode: sp.mode === "manual" || sp.mode === "automatic" ? sp.mode : undefined,
    from: day(sp.from),
    to: to ? new Date(to.getTime() + 86_400_000) : null, // inclusive of the end day
    min: amount(sp.min),
    max: amount(sp.max),
    page: Math.max(1, Number(sp.page) || 1),
  }
  const [page, settings] = await Promise.all([payoutsPage(filters), getPayoutSettings()])
  const params = { tab, q: filters.q, method: filters.method, mode: filters.mode, from: sp.from, to: sp.to, min: sp.min, max: sp.max }
  const walletReady = hotWalletReady()
  const filtered = !!(filters.q || filters.method || filters.mode || filters.from || filters.to || filters.min != null || filters.max != null)

  return (
    <div>
      <AdminPageHeader
        title="Payouts"
        description={settings.approval === "manual" ? "Manual approval is on: approve a payout, send it, then record the result." : "Automatic approval is on: payouts go straight to the queue to be sent."}
        action={
          <a href="/admin/affiliates/export/payouts" className={linkButtonClass}>
            <Download className="size-4" aria-hidden /> Export
          </a>
        }
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {settings.paused && (
          <p role="status" className="rounded-lg border border-[var(--loss)]/50 bg-[var(--loss)]/6 px-4 py-3 text-sm">
            <span className="font-semibold">All payouts are paused.</span> Nothing new can be approved or sent. Transactions already submitted are still tracked.{" "}
            <Link href="/admin/affiliates/payout-settings" className="font-medium text-primary hover:underline">
              Payout settings
            </Link>
          </p>
        )}

        <div className="inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-[3px]" role="group" aria-label="Status">
          {TABS.map(([v, text]) => (
            <Link key={v} href={`?tab=${v}`} aria-current={v === tab ? "true" : undefined} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${v === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {text}
              {page.groups[v] > 0 && <span className="tabular-nums text-muted-foreground">{page.groups[v]}</span>}
            </Link>
          ))}
        </div>

        <form className="flex flex-wrap items-end gap-3" method="get">
          <input type="hidden" name="tab" value={tab} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Affiliate
            <input name="q" defaultValue={filters.q ?? ""} placeholder="Name, email or code" className={`${inputClass} w-48`} />
          </label>
          <FilterSelect name="method" label="Method / network" defaultValue={filters.method} options={[["", "All methods"], ...PAYOUT_METHOD_TYPES.map((t) => [t, PAYOUT_METHOD_LABELS[t]] as [string, string])]} />
          <FilterSelect name="mode" label="Created" defaultValue={filters.mode} options={[["", "Any"], ["manual", "Requested"], ["automatic", "Automatic"]]} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Min $
            <input type="number" name="min" min={0} step="0.01" defaultValue={sp.min ?? ""} className={`${inputClass} w-24`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Max $
            <input type="number" name="max" min={0} step="0.01" defaultValue={sp.max ?? ""} className={`${inputClass} w-24`} />
          </label>
          <button type="submit" className="h-9 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Apply
          </button>
          {filtered && (
            <Link href={`?tab=${tab}`} className="h-9 content-center text-sm text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </form>

        {page.rows.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <Empty icon={Banknote} title={filtered ? "No payouts match these filters" : EMPTY[tab][0]}>
              {filtered ? "Try a different affiliate, method or date range." : EMPTY[tab][1] || undefined}
            </Empty>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {page.total} payout{page.total === 1 ? "" : "s"} · {money(page.sum)} in total
            </p>
            <TableShell>
              <THead>
                <tr>
                  <th className={thClass}>Payout ID</th>
                  <th className={thClass}>Affiliate</th>
                  <th className={`${thClass} text-end`}>Amount</th>
                  <th className={thClass}>Method</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Requested</th>
                  <th className={thClass}>Created</th>
                  <th className={`${thClass} text-end`}>Action</th>
                </tr>
              </THead>
              <tbody className="divide-y">
                {page.rows.map((p) => {
                  const name = `${p.firstName} ${p.lastName}`.trim()
                  const link = explorerTxUrl(p.network, p.transactionHash)
                  return (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className={tdClass}>
                        <Link href={`/admin/affiliates/payouts/${p.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                          PO-{p.id}
                        </Link>
                      </td>
                      <td className={tdClass}>
                        <Link href={`/admin/affiliates/${p.affiliateId}`} className="font-medium hover:underline">
                          {name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{p.email}</p>
                        {(p.fraudLock || p.payoutHold || p.affiliateStatus !== "approved") && <p className="text-[11px] text-[var(--chart-4)]">{p.affiliateStatus !== "approved" ? `Account ${p.affiliateStatus}` : p.fraudLock ? "Fraud lock is on — review before paying" : "Payout hold is on"}</p>}
                      </td>
                      <td className={`${tdClass} text-end tabular-nums font-medium`}>
                        {money(p.amount)}
                        {p.fee > 0 && <span className="block text-xs font-normal text-muted-foreground">net {money(p.net)}</span>}
                      </td>
                      <td className={tdClass}>
                        {methodLabel(p.methodType)}
                        <span className="block font-mono text-xs text-muted-foreground">{p.methodLabel}</span>
                      </td>
                      <td className={tdClass}>
                        <StatusBadge status={p.status} label={PAYOUT_STATUS_LABELS[p.status as PayoutStatus]} />
                        {p.transactionHash &&
                          (link ? (
                            <a href={link} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                              {maskTxHash(p.transactionHash)} <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : (
                            <span className="mt-1 block font-mono text-xs text-muted-foreground">{maskTxHash(p.transactionHash)}</span>
                          ))}
                        {p.failureReason && ["failed", "rejected", "reversed", "retry_required"].includes(p.status) && <span className="mt-1 block max-w-56 text-xs text-[var(--loss)]">{p.failureReason}</span>}
                        {p.provider === HOT_PROVIDER && p.status === "queued" && p.failureReason && <span className="mt-1 block max-w-56 text-xs text-[var(--chart-4)]">Waiting: {p.failureReason}</span>}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{fmtDay(p.requestedAt)}</td>
                      <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>
                        {p.mode === "automatic" ? "Automatic" : "Requested"}
                        {p.provider === HOT_PROVIDER && <span className="block text-xs">Sent by wallet</span>}
                      </td>
                      <td className={tdClass}>
                        {canManage && <PayoutAdminActions size="xs" paused={settings.paused} canAutoSend={walletReady} payout={{ id: p.id, status: p.status, methodType: p.methodType, amount: p.amount, net: p.net, fee: p.fee, asset: p.asset, name, hasHash: !!p.transactionHash, automated: providerByName(p.provider).automated, hot: p.provider === HOT_PROVIDER }} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableShell>
          </>
        )}
        {page.total > PAGE_SIZE && <Pager page={page.page} total={page.total} pageSize={PAGE_SIZE} params={params} />}
      </div>
    </div>
  )
}
