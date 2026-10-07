import { Check, ExternalLink, ShieldCheck, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { helpHref } from "@/lib/urls"
import type { IntegrationStatus, ProviderProfile } from "@/lib/compliance/engine"

// "<Provider> Safe Mode": what the provider's rules profile says, shown
// wherever one of its accounts is involved. Everything on it comes from the
// profile (lib/compliance): the lines, the status, the links to the provider's
// own pages. It tells the trader what TradeLoop applies; it promises nothing
// about what the provider will do.

const STATUS_TONE: Record<IntegrationStatus, string> = {
  supported: "border-[var(--gain)]/40 bg-[var(--gain)]/10 text-[var(--gain)]",
  restricted: "border-[var(--gain)]/40 bg-[var(--gain)]/10 text-[var(--gain)]",
  own_risk: "border-[var(--loss)]/40 bg-[var(--loss)]/10 text-[var(--loss)]",
  approval_required: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  disabled: "border-[var(--loss)]/40 bg-[var(--loss)]/10 text-[var(--loss)]",
}

export function IntegrationBadge({ status, label, className }: { status: IntegrationStatus; label: string; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase", STATUS_TONE[status], className)}>{label}</span>
}

export function SafeMode({ profile, className }: { profile: ProviderProfile; className?: string }) {
  const blocked = !profile.connectable && !profile.connection.allowed ? profile.connection : null
  return (
    <section aria-label={`${profile.name} Safe Mode`} className={cn("rounded-xl border bg-card p-3 text-sm", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
        <h3 className="font-semibold">{profile.name} Safe Mode</h3>
        <IntegrationBadge status={profile.status} label={profile.statusLabel} className="ms-auto" />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        This account is subject to {profile.name}-specific copy-trading and connection rules. TradeLoop applies the provider rules currently configured in our system.
      </p>
      <ul className="mt-2.5 space-y-1">
        {profile.lines.map((line) => (
          <li key={line.key} className="flex items-center gap-2">
            {line.allowed ? <Check className="size-3.5 shrink-0 text-[var(--gain)]" aria-hidden /> : <X className="size-3.5 shrink-0 text-[var(--loss)]" aria-hidden />}
            <span className={cn("text-xs", !line.allowed && "text-muted-foreground")}>{line.label}</span>
            <span className="sr-only">{line.allowed ? "permitted" : "not permitted"}</span>
          </li>
        ))}
      </ul>
      {blocked && (
        <p role="alert" className="mt-2.5 rounded-lg border border-loss/40 bg-loss/10 p-2.5 text-xs">
          {blocked.message}
          {profile.ownCopier && <> Between your own {profile.name} accounts, use {profile.ownCopier.name}.</>}
        </p>
      )}
      {profile.risk && (
        <p role="alert" className="mt-2.5 rounded-lg border border-loss/40 bg-loss/10 p-2.5 text-xs">
          <span className="font-semibold">Not permitted by {profile.name}.</span> {profile.risk}
          {profile.ownCopier && <> The way that stays within its rules is {profile.ownCopier.name}: see the guide below.</>}
        </p>
      )}
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Rules profile</dt>
        <dd className="tabular-nums">
          {profile.profile} · effective {profile.effectiveDate}
        </dd>
        <dt className="text-muted-foreground">Master authentication</dt>
        <dd>{profile.masterCredential}</dd>
      </dl>
      <p className="mt-2.5 text-[11px] text-muted-foreground">You remain responsible for complying with {profile.name}&apos;s current terms.</p>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {profile.guide && (
          <a href={helpHref(profile.guide)} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">
            How to use TradeLoop with a {profile.name} account
          </a>
        )}
        {profile.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {profile.name}: {s.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ))}
      </div>
    </section>
  )
}
