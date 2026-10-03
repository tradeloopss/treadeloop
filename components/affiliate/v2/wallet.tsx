"use client"

import { useId, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDownLeft, ArrowUpRight, ChevronRight, CircleDollarSign, ExternalLink, Eye, EyeOff, Gift, Hourglass, History, Plus, Receipt, SendHorizontal, SlidersHorizontal, Undo2, Wallet, type LucideIcon } from "lucide-react"
import { PayoutMethodDialog } from "@/components/affiliate/payout-method-dialog"
import type { MethodDialogConfig, MethodView, PayoutView } from "@/components/affiliate/payouts"
import { cryptoSpec, explorerTxUrl } from "@/lib/affiliates/crypto"
import { maskTxHash } from "@/lib/affiliates/tron"
import { methodLabel, money, signedMoney } from "@/lib/affiliates/types"
import { HIDE_BALANCE_COOKIE, TX_FILTERS, payoutRef, txGroup, txLabel, txRef, type TxFilterKey } from "@/lib/affiliates/v2/wallet"
import { affiliateHref } from "@/lib/urls"
import { cn } from "@/lib/utils"
import { CommissionDialog, type LedgerView } from "./ledger"
import { MethodSummary } from "./payout-methods"
import { DetailRows, Sheet, sheetBtnQuiet } from "./sheet"
import { CardLink, EmptyState, IconTile, StatusChip, V2Card, fmtDate } from "./ui"

// The Wallet: what you have, where it can be sent, and everything that has
// happened to it. It manages and tracks — nothing on it asks for a payout;
// that is the Payout page's job, and there is deliberately no button for it here.

const MASK = "••••••"

// --- Balance ---------------------------------------------------------------------------

// The balance over the period as one line. Drawn by hand (it is a dozen points):
// no axes, no tooltips — the figures are on the card.
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const W = 320
  const H = 64
  const PAD = 5
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W)
  const y = (v: number) => (span > 0 ? PAD + (1 - (v - min) / span) * (H - PAD * 2) : H / 2)
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--v2-violet-bright)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--v2-violet-bright)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--v2-violet-bright)" />
          <stop offset="1" stopColor="var(--v2-cyan)" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id}a)`} />
      <path d={line} fill="none" stroke={`url(#${id}s)`} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function BreakdownCard({ icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub: string }) {
  return (
    <div className="v2-card flex min-w-0 flex-col gap-1.5 p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        <IconTile icon={icon} size="sm" />
        <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="truncate text-lg font-semibold tracking-tight tabular-nums sm:text-xl">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

export type WalletTrend = { values: number[]; change: number | null }

export function WalletBalances({ available, pending, earned, paid, processing, trend, days = 30, initialHidden = false }: { available: number; pending: number; earned: number; paid: number; processing: number; trend: WalletTrend; days?: number; initialHidden?: boolean }) {
  const [hidden, setHidden] = useState(initialHidden)
  const toggle = () => {
    const next = !hidden
    setHidden(next)
    try {
      document.cookie = `${HIDE_BALANCE_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`
    } catch {
      // the choice still holds for this visit
    }
  }
  const show = (v: number) => (hidden ? MASK : money(v))
  const total = Math.round((available + pending) * 100) / 100
  const change = trend.change
  const flat = change != null && Math.abs(change) < 0.0005
  const pct = change == null ? null : `${Math.abs(change * 100) >= 100 ? Math.round(Math.abs(change * 100)) : Math.abs(change * 100).toFixed(1)}%`

  return (
    <div className="grid gap-3 sm:gap-4 lg:grid-cols-5 lg:gap-5">
      <section aria-label="Total balance" className="v2-card-glow relative isolate flex flex-col overflow-hidden lg:col-span-2">
        <div aria-hidden className="pointer-events-none absolute -end-16 -top-20 -z-10 size-56 rounded-full bg-[radial-gradient(circle,rgb(139_92_246/0.32),transparent_70%)]" />
        <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Total Balance</p>
            <p className="mt-1 truncate text-[34px] leading-none font-bold tracking-tight tabular-nums sm:text-[40px]" aria-live="polite">
              {hidden ? <span aria-label="Hidden">{MASK}</span> : money(total)}
            </p>
          </div>
          <button type="button" onClick={toggle} aria-pressed={hidden} aria-label={hidden ? "Show balances" : "Hide balances"} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background/50 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
            {hidden ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          </button>
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-xs text-muted-foreground sm:px-5">
          {pct != null ? (
            <>
              <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums", flat ? "border-border bg-muted text-muted-foreground" : change! > 0 ? "border-gain/25 bg-gain/12 text-gain" : "border-loss/25 bg-loss/12 text-loss")}>
                <span aria-hidden>{flat ? "→" : change! > 0 ? "↑" : "↓"}</span>
                <span className="sr-only">{flat ? "No change" : change! > 0 ? "Up" : "Down"}</span>
                {flat ? "0%" : pct}
              </span>
              vs {days} days ago
            </>
          ) : (
            <>Last {days} days</>
          )}
          {processing > 0 && <span className="text-muted-foreground">· {show(processing)} on its way to you</span>}
        </p>
        <div className="mt-auto pt-3">
          <Sparkline values={trend.values} className="block h-16 w-full sm:h-20 lg:h-28" />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-3">
        <BreakdownCard icon={Wallet} label="Available Balance" value={show(available)} sub="Ready balance" />
        <BreakdownCard icon={Hourglass} label="Pending Balance" value={show(pending)} sub="Currently pending" />
        <BreakdownCard icon={CircleDollarSign} label="Total Earned" value={show(earned)} sub="All time" />
        <BreakdownCard icon={SendHorizontal} label="Total Paid Out" value={show(paid)} sub="All time" />
      </div>
    </div>
  )
}

// --- Payout methods ---------------------------------------------------------------------

// The saved methods at a glance. A row opens that method on the management
// screen; adding one only saves the destination.
export function PayoutMethodsSection({ methods, config, manageHref }: { methods: MethodView[]; config: MethodDialogConfig; manageHref: string }) {
  const [adding, setAdding] = useState(false)
  const shown = methods.slice(0, 3)
  const canAdd = config.methods.length > 0
  return (
    <V2Card title="Payout Methods" subtitle="Where your payouts are sent." action={methods.length > 0 ? <CardLink href={manageHref}>Manage</CardLink> : undefined}>
      {methods.length === 0 ? (
        <EmptyState icon={Wallet} title="No payout methods yet" className="py-8">
          Add a payout method to receive your earnings.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((m) => (
            <li key={m.id}>
              <Link href={affiliateHref(`${manageHref}?m=${m.id}`)} className="group flex items-center gap-2 rounded-2xl border bg-background/30 p-3 transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.995]">
                <MethodSummary method={m} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {methods.length > shown.length && (
        <Link href={affiliateHref(manageHref)} className="mt-2 text-center text-xs font-medium text-primary hover:underline">
          + {methods.length - shown.length} more
        </Link>
      )}
      {canAdd && (
        <button type="button" onClick={() => setAdding(true)} className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/45 text-sm font-semibold text-primary transition-colors hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:translate-y-px">
          <Plus className="size-4" aria-hidden /> Add Payout Method
        </button>
      )}
      {canAdd && <PayoutMethodDialog open={adding} onOpenChange={setAdding} {...config} />}
    </V2Card>
  )
}

// --- Transactions ------------------------------------------------------------------------

// A ledger row, or (type "fee") the fee taken from a payout.
export type TxRow = LedgerView

const ICONS: Record<string, [LucideIcon, string]> = {
  subscription: [ArrowDownLeft, "border-gain/25 bg-gain/12 text-gain"],
  bonus: [Gift, "border-[var(--v2-violet-bright)]/30 bg-[var(--v2-violet-bright)]/12 text-[var(--v2-violet-bright)]"],
  payout: [ArrowUpRight, "border-primary/25 bg-primary/12 text-primary"],
  adjustment: [SlidersHorizontal, "border-border bg-muted text-muted-foreground"],
  refund: [Undo2, "border-loss/25 bg-loss/12 text-loss"],
  reversal: [Undo2, "border-loss/25 bg-loss/12 text-loss"],
  fee: [Receipt, "border-border bg-muted text-muted-foreground"],
}
// Rows that count for nothing any more: the record stays, the money doesn't.
const DEAD = ["cancelled", "reversed", "refunded"]
const isPayoutRow = (r: TxRow) => r.type === "payout" || r.type === "fee"
const payoutMethodName = (p: PayoutView) => cryptoSpec(p.methodType)?.asset ?? methodLabel(p.methodType)

function describeTx(r: TxRow, payout?: PayoutView): string {
  if (r.type === "subscription") return r.baseAmount != null ? `${r.ratePercent}% of ${money(r.baseAmount)}${r.referral ? ` · ${r.referral}` : ""}` : (r.referral ?? "Commission")
  if (r.type === "payout") return payout ? `${payoutMethodName(payout)} · ${payout.methodLabel}` : "Sent to your payout method"
  if (r.type === "fee") return `Fee on payout ${payoutRef(r.payoutId ?? r.id)}`
  return r.note ?? r.referral ?? txLabel(r.type)
}
const amountTone = (r: TxRow) => (DEAD.includes(r.status) ? "text-muted-foreground" : r.amount > 0 ? "text-gain" : isPayoutRow(r) ? "text-foreground" : "text-loss")

function TxStatus({ row, payout }: { row: TxRow; payout?: PayoutView }) {
  return isPayoutRow(row) ? <StatusChip status={payout?.status ?? row.status} kind="payout" /> : <StatusChip status={row.status} />
}

function TxIcon({ type }: { type: string }) {
  const [Icon, tone] = ICONS[type] ?? ICONS.adjustment
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border", tone)} aria-hidden>
      <Icon className="size-[18px]" />
    </span>
  )
}

// Transactions as cards: what it was, when, how much, and its state. Each opens its details.
export function TransactionList({ rows, payouts }: { rows: TxRow[]; payouts: PayoutView[] }) {
  const [open, setOpen] = useState<TxRow | null>(null)
  const [timeline, setTimeline] = useState<LedgerView | null>(null)
  const byId = useMemo(() => new Map(payouts.map((p) => [p.id, p])), [payouts])
  const payoutOf = (r: TxRow | null) => (r?.payoutId != null ? byId.get(r.payoutId) : undefined)
  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const payout = payoutOf(r)
          return (
            <li key={`${r.type}-${r.id}`}>
              <button type="button" onClick={() => setOpen(r)} aria-label={`${txLabel(r.type)}, ${signedMoney(r.amount)}, ${fmtDate(r.createdAt)}: details`} className="group flex w-full items-center gap-3 rounded-2xl border bg-background/30 p-3 text-start transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.995]">
                <TxIcon type={r.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{txLabel(r.type)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{describeTx(r, payout)}</span>
                  <span className="block text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("text-sm font-semibold tabular-nums", amountTone(r))}>{signedMoney(r.amount)}</span>
                  <TxStatus row={r} payout={payout} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <TransactionSheet
        row={open}
        payout={payoutOf(open)}
        onClose={() => setOpen(null)}
        onTimeline={(r) => {
          setOpen(null)
          setTimeline(r)
        }}
      />
      <CommissionDialog row={timeline} onClose={() => setTimeline(null)} />
    </>
  )
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
const RULES: Record<string, string> = { affiliate: "Custom rate", campaign: "Campaign rate", coupon: "Coupon rate", tier: "Tier rate", default: "Standard rate" }

// One transaction, in full: what, how much, when, where it came from, and the
// reference to quote if you write to support.
function TransactionSheet({ row, payout, onClose, onTimeline }: { row: TxRow | null; payout?: PayoutView; onClose: () => void; onTimeline: (row: LedgerView) => void }) {
  const ref = row ? txRef(row.type, row.id) : ""
  const link = payout ? explorerTxUrl(payout.network, payout.transactionHash) : null
  return (
    <Sheet
      open={!!row}
      onOpenChange={(next) => !next && onClose()}
      title="Transaction Details"
      description={row ? `${txLabel(row.type)} · ${fmtDate(row.createdAt)}` : undefined}
      footer={
        row?.type === "subscription" && row.referral ? (
          <button type="button" className={sheetBtnQuiet} onClick={() => onTimeline(row)}>
            <History className="size-4" aria-hidden /> View Timeline
          </button>
        ) : undefined
      }
    >
      {row && (
        <>
          <div className="flex flex-col items-center gap-2 rounded-2xl border bg-background/40 px-4 py-5 text-center">
            <TxIcon type={row.type} />
            <p className={cn("text-3xl leading-none font-bold tracking-tight tabular-nums", amountTone(row))}>{signedMoney(row.amount)}</p>
            <TxStatus row={row} payout={payout} />
          </div>
          <DetailRows
            rows={[
              { label: "Type", value: txLabel(row.type) },
              { label: "Amount", value: signedMoney(row.amount) },
              { label: "Status", value: <TxStatus row={row} payout={payout} /> },
              { label: "Date", value: fmtDate(row.createdAt) },
              { label: "Time", value: fmtTime(row.createdAt) },
              !(row.type === "payout" && payout) && { label: row.type === "subscription" ? "Source" : "Description", value: describeTx(row, payout) },
              row.type === "subscription" && row.plan && { label: "Plan", value: <span className="capitalize">{row.plan}</span> },
              row.type === "subscription" && row.ruleSource && { label: "Rate", value: `${row.ratePercent != null ? `${row.ratePercent}% · ` : ""}${RULES[row.ruleSource] ?? row.ruleSource}` },
              row.type === "subscription" && !DEAD.includes(row.status) && { label: "Available", value: ["available", "paid"].includes(row.status) ? "Now" : row.holdUntil ? fmtDate(row.holdUntil) : "After its holding period" },
              payout && row.type === "payout" && { label: "Method", value: payoutMethodName(payout) },
              payout && { label: "Destination", value: <span className="font-mono">{payout.methodLabel}</span> },
              payout && payout.fee > 0 && row.type === "payout" && !DEAD.includes(row.status) && { label: "Fee", value: `− ${money(payout.fee)}` },
              payout && payout.fee > 0 && row.type === "payout" && !DEAD.includes(row.status) && { label: payout.status === "paid" ? "You received" : "You receive", value: money(payout.net), strong: true },
              payout?.completedAt && { label: "Completed", value: fmtDate(payout.completedAt) },
              row.payoutId != null && { label: "Payout ID", value: <span className="font-mono">{payoutRef(row.payoutId)}</span>, copy: { value: payoutRef(row.payoutId), label: "Copy payout ID", done: "Payout ID copied" } },
              payout?.transactionHash && {
                label: "Transaction hash",
                value: link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                    {maskTxHash(payout.transactionHash)} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span className="font-mono">{maskTxHash(payout.transactionHash)}</span>
                ),
                copy: { value: payout.transactionHash, label: "Copy transaction hash", done: "Transaction hash copied" },
              },
              { label: "Transaction ID", value: <span className="font-mono">{ref}</span>, copy: { value: ref, label: "Copy transaction ID", done: "Transaction ID copied" } },
            ]}
          />
          {row.type === "fee" && <p className="text-xs text-muted-foreground">This fee is part of the payout it was taken from — it isn&apos;t deducted from your balance a second time.</p>}
          {payout && ["failed", "rejected", "reversed"].includes(payout.status) && payout.failureReason && <p className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3.5 py-2.5 text-[13px] text-loss">{payout.failureReason}</p>}
        </>
      )}
    </Sheet>
  )
}

const EMPTY: Record<TxFilterKey, [string, string]> = {
  all: ["No transactions yet", "Your earnings and payouts will appear here."],
  earnings: ["No earnings yet", "Commission from your referrals will appear here."],
  payouts: ["No payouts yet", "Payouts you've been sent will appear here."],
  bonuses: ["No bonuses yet", "Bonuses added to your balance will appear here."],
  adjustments: ["No adjustments", "Refunds, reversals and manual adjustments will appear here."],
  fees: ["No fees", "You haven't been charged any payout fees."],
}
export function TransactionsEmpty({ filter }: { filter: TxFilterKey }) {
  const [title, body] = EMPTY[filter]
  return (
    <EmptyState icon={Receipt} title={title} className="py-8">
      {body}
    </EmptyState>
  )
}

// The Wallet's Transaction History: the latest rows, filtered in place by the
// pills; "View All" opens the full, paged list with the same filter.
export function TransactionHistory({ rows, fees, counts, payouts, limit = 6, allHref }: { rows: TxRow[]; fees: TxRow[]; counts: Record<TxFilterKey, number>; payouts: PayoutView[]; limit?: number; allHref: string }) {
  const [filter, setFilter] = useState<TxFilterKey>("all")
  const matching = filter === "fees" ? fees : filter === "all" ? rows : rows.filter((r) => txGroup(r.type) === filter)
  const shown = matching.slice(0, limit)
  const total = counts[filter]
  const href = `${allHref}${filter === "all" ? "" : `?tab=${filter}`}`
  return (
    <V2Card title="Transaction History" subtitle="Everything that changed your balance." action={counts.all + counts.fees > 0 ? <CardLink href={href}>View All</CardLink> : undefined}>
      <div role="group" aria-label="Filter transactions" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden">
        {TX_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={(e) => {
              setFilter(f.key)
              // keep the chosen pill in view when the row is scrolled
              e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
            }}
            className={cn("inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-all focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-95 motion-reduce:transition-none", filter === f.key ? "v2-nav-active" : "border bg-card/60 text-muted-foreground hover:text-foreground")}
          >
            {f.label}
          </button>
        ))}
      </div>
      {total === 0 ? (
        <TransactionsEmpty filter={filter} />
      ) : shown.length === 0 ? (
        // There are some, just none among the latest rows loaded here.
        <Link href={affiliateHref(href)} className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed px-4 py-8 text-sm font-medium text-primary hover:bg-primary/[0.05]">
          View all {total.toLocaleString("en-US")} <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <div key={filter} className="v2-fade-up">
          <TransactionList rows={shown} payouts={payouts} />
        </div>
      )}
      {filter === "fees" && total > 0 && <p className="mt-3 text-xs text-muted-foreground">A payout fee is taken from the payout itself — the amounts under Payouts already include it.</p>}
      {total > shown.length && shown.length > 0 && (
        <Link href={affiliateHref(href)} className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
          View all {total.toLocaleString("en-US")} <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </V2Card>
  )
}
