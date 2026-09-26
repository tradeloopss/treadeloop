import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, HelpCircle, ExternalLink } from "lucide-react"
import { getPropMaxAccountDetail } from "@/app/actions/propmax"
import { RuleRow } from "@/components/propmax/propmax-workspace"
import { STATUS_META, ruleLabel, formatSize, phaseLabel, confidenceLabel, timeAgo } from "@/components/propmax/display"

export const metadata = { title: "Account — PropFirm Max" }

export default async function PropMaxAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const id = Number(accountId)
  if (!Number.isFinite(id)) notFound()

  const { account } = await getPropMaxAccountDetail(id)
  if (!account) notFound()

  const b = account.binding
  const evaln = account.evaluation

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <Link href="/propfirm-max" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> PropFirm Max
      </Link>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
          {evaln && <RiskBadge status={evaln.risk.status} />}
        </div>
        {b ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {b.firmName ?? "Unassigned"}
            {b.programName ? ` · ${b.programName}` : ""} · {formatSize(b.accountSize)} · {phaseLabel(b.phase)}
            {b.versionLabel ? ` · ${b.versionLabel}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not tracked under PropFirm Max yet.</p>
        )}
      </div>

      {!evaln || !b ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Set this account up on the main PropFirm Max page to see its rule evaluation.
        </p>
      ) : (
        <>
          {!evaln.risk.dataFresh && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-500/30 bg-slate-500/5 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">
              <HelpCircle className="size-4" /> Data may be stale — last synced {timeAgo(evaln.evaluatedAt)}. Values below are from the latest sync.
            </div>
          )}

          <section className="mb-6 rounded-xl border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Rules</h2>
            <div className="space-y-4">
              {evaln.rules.map((r) => (
                <div key={r.type}>
                  <RuleRow rule={r} currency={account.currency} />
                  <p className="mt-1 text-xs text-muted-foreground">{r.explanation}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-6 rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Payout eligibility</h2>
            {evaln.payout.determinable ? (
              <ul className="space-y-1.5 text-sm">
                {evaln.payout.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={evaln.payout.eligible ? "text-[var(--gain)]" : "text-muted-foreground"}>•</span>
                    <span className="text-muted-foreground">{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <HelpCircle className="size-4" /> {evaln.payout.reasons[0] ?? "Not enough data to judge eligibility."}
              </p>
            )}
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Source & confidence</h2>
            {b.source ? (
              <div className="text-sm">
                <p className="font-medium">{b.source.name}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {confidenceLabel(b.source.confidence)}
                  {b.source.verifiedAt ? ` · verified ${new Date(b.source.verifiedAt).toLocaleDateString()}` : ""}
                </p>
                {b.source.url && (
                  <a href={b.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
                    View source <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No source recorded.</p>
            )}
            {b.caveat && <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">Note: {b.caveat}</p>}
          </section>
        </>
      )}
    </div>
  )
}

function RiskBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.unknown
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.pill}`}>{meta.label}</span>
}
