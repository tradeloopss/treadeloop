"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import {
  ShieldCheck,
  ShieldAlert,
  TriangleAlert,
  HelpCircle,
  Clock,
  Gauge,
  ChevronRight,
  Plus,
  CircleDollarSign,
  BadgeCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PropMaxAccountView } from "@/lib/propmax/account"
import type { CatalogOption } from "@/lib/propmax/view-types"
import { removePropMaxAccount } from "@/app/actions/propmax"
import type { RuleResult } from "@/lib/propmax/types"
import { PropMaxSetupDialog } from "@/components/propmax/setup-dialog"
import {
  STATUS_META,
  ruleLabel,
  formatValue,
  formatMoney,
  formatSize,
  phaseLabel,
  confidenceLabel,
} from "@/components/propmax/display"

export function PropMaxWorkspace({ accounts, catalog }: { accounts: PropMaxAccountView[]; catalog: CatalogOption[] }) {
  const bound = accounts.filter((a) => a.binding && a.evaluation)
  const unbound = accounts.filter((a) => !a.binding)

  const summary = useMemo(() => {
    let breached = 0
    let atRisk = 0
    let stale = 0
    for (const a of bound) {
      const s = a.evaluation!.risk.status
      if (s === "breached") breached++
      else if (s === "warning" || s === "critical") atRisk++
      if (a.evaluation!.risk.status === "stale" || !a.evaluation!.risk.dataFresh) stale++
    }
    return { tracked: bound.length, breached, atRisk, stale }
  }, [bound])

  const catalogEmpty = catalog.length === 0

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gauge className="size-5" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">PropFirm Max</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every prop account measured against its firm&apos;s exact, sourced rules — with pre-breach warnings and honest UNKNOWNs when the data can&apos;t
            confirm a rule.
          </p>
        </div>
        {summary.tracked > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <Stat label="Tracked" value={summary.tracked} />
            <Stat label="At risk" value={summary.atRisk} tone={summary.atRisk ? "warning" : undefined} />
            <Stat label="Breached" value={summary.breached} tone={summary.breached ? "loss" : undefined} />
          </div>
        )}
      </header>

      {catalogEmpty && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p className="text-muted-foreground">
            The rule catalog hasn&apos;t been seeded yet. An admin can seed it from the researched presets before accounts can be set up.
          </p>
        </div>
      )}

      {bound.length === 0 && unbound.length === 0 && (
        <EmptyState />
      )}

      {bound.length > 0 && (
        <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {bound.map((a) => (
            <AccountCard key={a.accountId} account={a} />
          ))}
        </section>
      )}

      {unbound.length > 0 && !catalogEmpty && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Not tracked yet</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {unbound.map((a) => (
              <SetupCard key={a.accountId} account={a} catalog={catalog} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "loss" }) {
  return (
    <div className="text-center">
      <div className={cn("text-xl font-semibold tabular-nums", tone === "warning" && "text-amber-500", tone === "loss" && "text-[var(--loss)]")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function RiskPill({ status }: { status: string }) {
  const meta = STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.unknown
  const Icon = status === "breached" ? ShieldAlert : status === "safe" ? ShieldCheck : status === "unknown" || status === "stale" ? HelpCircle : TriangleAlert
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", meta.pill)}>
      <Icon className="size-3.5" />
      {meta.label}
    </span>
  )
}

function AccountCard({ account }: { account: PropMaxAccountView }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const b = account.binding!
  const evaln = account.evaluation!
  const closest = evaln.risk.closest

  function onRemove() {
    if (!confirm(`Stop tracking ${account.name} in PropFirm Max? Its trades and the old tracker are untouched.`)) return
    startTransition(async () => {
      try {
        await removePropMaxAccount(account.accountId)
        toast.success("Stopped tracking.")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't remove.")
      }
    })
  }

  return (
    <div className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{account.name}</h3>
            <RiskPill status={evaln.risk.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {b.firmName ?? "Unassigned firm"}
            {b.programName ? ` · ${b.programName}` : ""} · {formatSize(b.accountSize)} · {phaseLabel(b.phase)}
          </p>
        </div>
        {!account.evaluation?.risk.dataFresh && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">
            <Clock className="size-3.5" /> stale
          </span>
        )}
      </div>

      {!b.confirmed && (
        <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-muted-foreground">
          Auto-detected ({confidenceLabel(b.detectionConfidence)}) — confirm the firm and program are right.
        </p>
      )}

      {closest && closest.status !== "safe" && (
        <div className="mb-4 rounded-lg border bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <span className={cn("inline-block size-2 rounded-full", STATUS_META[closest.status].dot)} />
            Closest to breach: {ruleLabel(closest.type)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{closest.explanation}</p>
        </div>
      )}

      <div className="flex-1 space-y-2.5">
        {evaln.rules.map((r) => (
          <RuleRow key={r.type} rule={r} currency={account.currency} />
        ))}
      </div>

      <PayoutLine evaln={evaln} currency={account.currency} />

      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {b.source ? (
            <>
              {b.source.name} · {confidenceLabel(b.source.confidence)}
            </>
          ) : (
            "No source on file"
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRemove} disabled={pending}>
            Untrack
          </Button>
          <Link
            href={`/propfirm-max/${account.accountId}`}
            className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10"
          >
            Details <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </div>

      {b.caveat && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">Note: {b.caveat}</p>}
    </div>
  )
}

export function RuleRow({ rule, currency }: { rule: RuleResult; currency: string }) {
  const meta = STATUS_META[rule.status]
  const pct = rule.percentageUsed != null ? Math.max(0, Math.min(100, rule.percentageUsed)) : null
  const showBar = pct != null && (rule.status === "safe" || rule.status === "watch" || rule.status === "warning" || rule.status === "critical" || rule.status === "breached")

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 truncate">
          <span className={cn("inline-block size-1.5 rounded-full", meta.dot)} />
          <span className="truncate">{ruleLabel(rule.type)}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {rule.status === "unknown" || rule.status === "stale" ? (
            <span className={meta.text}>{meta.label}</span>
          ) : rule.currentValue != null && rule.limitValue != null ? (
            <>
              {formatValue(rule.currentValue, rule.unit, currency)}
              <span className="text-muted-foreground/50"> / {formatValue(rule.limitValue, rule.unit, currency)}</span>
            </>
          ) : (
            <span className={meta.text}>{meta.label}</span>
          )}
        </span>
      </div>
      {showBar ? (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", meta.bar)} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className="mt-1 h-1.5 w-full rounded-full bg-muted/50" />
      )}
    </div>
  )
}

function PayoutLine({ evaln, currency }: { evaln: PropMaxAccountView["evaluation"]; currency: string }) {
  if (!evaln) return null
  const p = evaln.payout
  if (!p.determinable) {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <HelpCircle className="size-3.5" /> Payout eligibility can&apos;t be judged yet.
      </div>
    )
  }
  return (
    <div className={cn("mt-3 flex items-center gap-1.5 text-xs", p.eligible ? "text-[var(--gain)]" : "text-muted-foreground")}>
      {p.eligible ? <BadgeCheck className="size-3.5" /> : <CircleDollarSign className="size-3.5" />}
      {p.eligible ? "Payout requirements met." : p.reasons[0] ?? "Payout not available yet."}
    </div>
  )
  void currency
}

function SetupCard({ account, catalog }: { account: PropMaxAccountView; catalog: CatalogOption[] }) {
  const d = account.detection
  return (
    <div className="flex flex-col rounded-xl border border-dashed bg-card/50 p-4">
      <h3 className="truncate font-medium">{account.name}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {formatMoney(account.startingBalance, account.currency)}
        {account.broker ? ` · ${account.broker}` : ""}
      </p>
      {d?.reason && <p className="mt-2 flex-1 text-xs text-muted-foreground">{d.reason}</p>}
      <PropMaxSetupDialog
        accountId={account.accountId}
        accountName={account.name}
        catalog={catalog}
        detection={d}
        trigger={
          <Button size="sm" variant="outline" className="mt-3 w-full">
            <Plus className="size-4" /> Set up tracking
          </Button>
        }
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Gauge className="size-6" />
      </span>
      <h2 className="text-lg font-medium">No accounts yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Add a trading account (or connect a broker) and it&apos;ll show up here, ready to track against your prop firm&apos;s rules.
      </p>
      <Link href="/accounts" className="mt-4">
        <Button variant="outline" size="sm">
          Go to accounts
        </Button>
      </Link>
    </div>
  )
}
