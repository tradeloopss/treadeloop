import Link from "next/link"
import { ArrowRight, Award, Banknote, Bell, CircleDollarSign, CreditCard, Gem, Lightbulb, Medal, MousePointerClick, RotateCcw, Sparkles, Target, TrendingUp, Trophy, UserPlus, Users, Wallet, type LucideIcon } from "lucide-react"
import type { Achievement, Goal, Insight } from "@/lib/affiliates/v2/config"
import { money } from "@/lib/affiliates/types"
import { affiliateHref, portalHref } from "@/lib/urls"
import { ReferralLinkActions } from "./referral-link"
import { Greeting } from "./greeting"
import { Bar, CardLink, IconTile, ProgressRow, V2Card, btnClass, fmtAgo } from "./ui"
import { cn } from "@/lib/utils"

// --- Hero -----------------------------------------------------------------------

export function HeroArt({ className }: { className?: string }) {
  // Two linked rings and a glowing cube: the referral loop. Pure SVG, theme-tinted.
  return (
    <svg viewBox="0 0 320 180" className={className} aria-hidden>
      <defs>
        <linearGradient id="v2h-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset=".55" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="v2h-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="v2h-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id="v2h-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#8b5cf6" stopOpacity=".55" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
        <filter id="v2h-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <ellipse cx="190" cy="110" rx="120" ry="60" fill="url(#v2h-glow)" />
      {/* the cube */}
      <g transform="translate(150 70)">
        <path d="M40 0 80 22 40 44 0 22Z" fill="url(#v2h-top)" />
        <path d="M0 22 40 44 40 92 0 70Z" fill="#5b21b6" />
        <path d="M80 22 40 44 40 92 80 70Z" fill="#1d4ed8" />
        <path d="M40 0 80 22 40 44 0 22Z" fill="none" stroke="#ddd6fe" strokeOpacity=".7" />
        <path d="M24 31 40 40 56 31" fill="none" stroke="#e9d5ff" strokeWidth="2" strokeLinecap="round" opacity=".9" />
      </g>
      {/* linked rings */}
      <g filter="url(#v2h-blur)" opacity=".55">
        <rect x="58" y="22" width="78" height="44" rx="22" transform="rotate(-28 97 44)" fill="none" stroke="#8b5cf6" strokeWidth="10" />
      </g>
      <rect x="58" y="22" width="78" height="44" rx="22" transform="rotate(-28 97 44)" fill="none" stroke="url(#v2h-a)" strokeWidth="9" />
      <rect x="104" y="40" width="78" height="44" rx="22" transform="rotate(-28 143 62)" fill="none" stroke="url(#v2h-b)" strokeWidth="9" />
      <circle cx="262" cy="34" r="3" fill="#22d3ee" />
      <circle cx="40" cy="132" r="2.5" fill="#a78bfa" />
      <circle cx="288" cy="118" r="2" fill="#d946ef" />
    </svg>
  )
}

export function HeroBanner({ rateText, url }: { rateText: string; url: string }) {
  return (
    // The artwork sits behind the content: faded in the corner on a narrow
    // banner, in the free space under the two columns on a wide one (a
    // container query — the banner's own width, not the screen's).
    <section className="v2-card-glow @container relative flex h-full min-w-0 flex-col justify-center overflow-hidden p-5 sm:p-6">
      <HeroArt className="pointer-events-none absolute -end-10 -top-6 w-[210px] opacity-40 @xl:start-[34%] @xl:end-auto @xl:top-auto @xl:-bottom-7 @xl:w-[270px] @xl:opacity-90" />
      <div className="relative grid min-w-0 gap-5 @xl:grid-cols-2 @xl:items-start @xl:pb-16">
      <div className="relative min-w-0">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          <Sparkles className="size-3.5" aria-hidden /> Affiliate Program
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-[28px]">
          Earn <span className="v2-text-gradient">{rateText}</span> Commission
        </h2>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">Invite friends and earn commission on every payment they make.</p>
        <Link href={affiliateHref("/affiliate/v2/campaigns")} className={cn(btnClass, "mt-4 h-10 px-4")}>
          View Campaigns <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <div className="relative min-w-0">
        <p className="mb-2 text-sm font-semibold">Your referral link</p>
        <ReferralLinkActions url={url} />
      </div>
      </div>
    </section>
  )
}

// --- Today's focus -------------------------------------------------------------------

const INSIGHT_ICONS: Record<Insight["kind"], LucideIcon> = { money: CircleDollarSign, tier: Medal, source: TrendingUp, conversion: Target, link: MousePointerClick }

export function TodaysFocus({ firstName, items }: { firstName: string; items: Insight[] }) {
  return (
    <section className="v2-card relative flex h-full min-w-0 flex-col overflow-hidden p-5">
      <div aria-hidden className="pointer-events-none absolute -end-10 -top-10 size-40 rounded-full bg-[radial-gradient(circle,rgb(37_99_235/0.18),transparent_70%)]" />
      <p className="relative text-lg font-semibold tracking-tight">
        <Greeting name={firstName} />
      </p>
      <p className="relative mt-0.5 text-xs text-muted-foreground">Here&apos;s what matters today.</p>
      <p className="relative mt-4 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
        <Lightbulb className="size-3.5" aria-hidden /> Today&apos;s focus
      </p>
      {items.length === 0 ? (
        <p className="relative mt-2 rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">Not enough data yet. Insights appear here once your link starts bringing in clicks and customers.</p>
      ) : (
        <ul className="relative mt-2 flex flex-col gap-1.5">
          {items.slice(0, 3).map((i) => {
            const Icon = INSIGHT_ICONS[i.kind]
            return (
              <li key={i.key}>
                <Link href={affiliateHref(i.href)} className="group flex items-center gap-3 rounded-xl border bg-background/40 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary/[0.05]">
                  <IconTile icon={Icon} size="sm" />
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">{i.text}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <Link href={affiliateHref("/affiliate/v2/analytics")} className={cn(btnClass, "relative mt-4 h-9 self-start")}>
        View Insights <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  )
}

// --- Funnels ----------------------------------------------------------------------------

export type FunnelTotals = { clicks: number; signups: number; trials: number; customers: number }
const pct2 = (v: number) => `${(Math.round(v * 10000) / 100).toFixed(2)}%`

// Each stage as a share of clicks.
export function CommissionBreakdown({ t, className }: { t: FunnelTotals; className?: string }) {
  const of = Math.max(t.clicks, t.signups, 1)
  return (
    <V2Card title="Commission breakdown" subtitle={`Click → customer: ${t.clicks ? pct2(t.customers / t.clicks) : "—"}`} className={className}>
      <ProgressRow label="Clicks" value={t.clicks} of={of} />
      <ProgressRow label="Sign-ups" value={t.signups} of={of} />
      <ProgressRow label="Trials started" value={t.trials} of={of} />
      <ProgressRow label="Paying customers" value={t.customers} of={of} />
    </V2Card>
  )
}

// Each stage against the one before it.
export function ConversionFunnel({ t, className }: { t: FunnelTotals; className?: string }) {
  const step = (a: number, b: number) => (b > 0 ? a / b : 0)
  return (
    <V2Card title="Conversion funnel" subtitle="How many move on to the next step" className={className}>
      <ProgressRow label="Clicks" value={t.clicks} of={Math.max(t.clicks, 1)} note="100%" />
      <ProgressRow label="Click → sign-up" value={t.signups} of={Math.max(t.clicks, t.signups, 1)} note={t.clicks ? pct2(step(t.signups, t.clicks)) : "—"} />
      <ProgressRow label="Sign-up → trial" value={t.trials} of={Math.max(t.signups, t.trials, 1)} note={t.signups ? pct2(step(t.trials, t.signups)) : "—"} />
      <ProgressRow label="Sign-up → paying" value={t.customers} of={Math.max(t.signups, t.customers, 1)} note={t.signups ? pct2(step(t.customers, t.signups)) : "—"} />
    </V2Card>
  )
}

// --- Wallet preview ---------------------------------------------------------------------

// The Wallet at a glance. Like the Wallet itself it only shows and links —
// asking for a payout is the Payout page's (and the balance card's) job.
export function WalletPreview({ available, pending, lifetime, walletHref, payoutHref, className }: { available: number; pending: number; lifetime: number; walletHref: string | null; payoutHref: string; className?: string }) {
  return (
    <V2Card title="Wallet" subtitle="Your balance at a glance." glow className={className}>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Total balance</p>
        <p className="truncate text-2xl font-semibold tracking-tight tabular-nums">{money(available + pending)}</p>
      </div>
      <dl className="mt-4 space-y-2 text-[13px]">
        {(
          [
            [Wallet, "Available balance", available],
            [RotateCcw, "Pending commission", pending],
            [CircleDollarSign, "Lifetime earned", lifetime],
          ] as const
        ).map(([Icon, label, value]) => (
          <div key={label} className="flex items-center gap-2">
            <Icon className="size-4 text-primary" aria-hidden />
            <dt className="flex-1 text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{money(value)}</dd>
          </div>
        ))}
      </dl>
      <Link href={affiliateHref(walletHref ?? payoutHref)} className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-primary/40 text-sm font-semibold text-primary transition-colors hover:bg-primary/10">
        {walletHref ? "View Wallet" : "Go to Payout"} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </V2Card>
  )
}

// --- Tiers -----------------------------------------------------------------------------------

export type TierView = { id: number; name: string; minCustomers: number; rateText: string; style: string }
const TIER_TINT: Record<string, string> = {
  bronze: "from-[#b45309] to-[#f59e0b]",
  silver: "from-[#64748b] to-[#cbd5e1]",
  gold: "from-[#ca8a04] to-[#fde047]",
  diamond: "from-[#06b6d4] to-[#8b5cf6]",
  plain: "from-[var(--v2-violet)] to-[var(--v2-blue)]",
}
export function TierBadge({ style, className }: { style: string; className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-[0_0_14px_-4px_rgb(139_92_246/0.6)]", TIER_TINT[style] ?? TIER_TINT.plain, className)} aria-hidden>
      {style === "diamond" ? <Gem className="size-4" /> : <Award className="size-4" />}
    </span>
  )
}

export function TierProgress({ tiers, currentId, customers, next }: { tiers: TierView[]; currentId: number | null; customers: number; next: TierView | null }) {
  return (
    <V2Card title={next ? `${next.minCustomers - customers} more paying customer${next.minCustomers - customers === 1 ? "" : "s"} to reach ${next.name}` : "You're on the top tier"} subtitle="You move up automatically as your paying customers grow. The tier you're in when a customer pays decides the rate for that payment.">
      {next && (
        <div className="mb-4">
          <Bar value={customers / next.minCustomers} label={`Progress to ${next.name}`} />
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {customers} / {next.minCustomers} paying customers · {next.name} pays {next.rateText}
          </p>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiers.map((t) => {
          const current = t.id === currentId
          return (
            <li key={t.id} className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2.5", current ? "border-primary/50 bg-primary/[0.08]" : "bg-background/30")} aria-current={current ? "true" : undefined}>
              <TierBadge style={t.style} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {t.name}
                  {current && <span className="rounded-full bg-primary px-1.5 text-[9px] font-bold text-primary-foreground uppercase">You</span>}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.rateText}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </V2Card>
  )
}

// --- Activity --------------------------------------------------------------------------------

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  referral: UserPlus,
  signup: UserPlus,
  trial: Sparkles,
  commission: CircleDollarSign,
  payment: CircleDollarSign,
  subscription: CircleDollarSign,
  bonus: CircleDollarSign,
  commission_available: Wallet,
  payout: Banknote,
  payout_method: CreditCard,
  stripe: CreditCard,
  tier: Trophy,
  refund: RotateCcw,
  reversal: RotateCcw,
  chargeback: RotateCcw,
  cancelled: RotateCcw,
}
export type ActivityView = { id: number; type: string; title: string; body: string | null; href: string | null; at: string }

export function ActivityList({ items, limit = 6, className, card = true }: { items: ActivityView[]; limit?: number; className?: string; card?: boolean }) {
  const list = (
    <ol className="flex flex-col">
      {items.slice(0, limit).map((a) => {
        const Icon = ACTIVITY_ICONS[a.type] ?? Bell
        const inner = (
          <>
            <IconTile icon={Icon} size="sm" className="rounded-full" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{a.title}</span>
              {a.body && <span className="block truncate text-xs text-muted-foreground">{a.body}</span>}
            </span>
            <time dateTime={a.at} className="shrink-0 text-[11px] text-muted-foreground">
              {fmtAgo(a.at)}
            </time>
          </>
        )
        return (
          <li key={a.id}>
            {a.href ? (
              <Link href={portalHref(a.href)} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                {inner}
              </Link>
            ) : (
              <div className="flex items-center gap-3 py-2">{inner}</div>
            )}
          </li>
        )
      })}
      {items.length === 0 && <li className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet. New referrals, commissions and payouts show up here.</li>}
    </ol>
  )
  if (!card) return list
  return (
    <V2Card title="Recent activity" action={<CardLink href="/affiliate/v2/activity">View all</CardLink>} className={className}>
      {list}
    </V2Card>
  )
}

// --- Goals ------------------------------------------------------------------------------------

const goalValue = (g: Goal, v: number) => (g.money ? money(v) : v.toLocaleString("en-US"))

export function GoalRow({ g, compact }: { g: Goal; compact?: boolean }) {
  return (
    <div className={cn(compact ? "py-1.5" : "rounded-xl border bg-background/30 p-3")}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate font-medium">{g.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {goalValue(g, g.value)} / {goalValue(g, g.target)}
        </span>
      </div>
      <Bar value={g.progress} label={g.title} className="mt-1.5 h-1.5" />
      {!compact && (
        <p className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{g.description}</span>
          <span>{g.done ? "Completed" : `Ends ${new Date(g.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`}</span>
        </p>
      )}
    </div>
  )
}

export function GoalsCard({ goal, challenges, className }: { goal: Goal; challenges: Goal[]; className?: string }) {
  return (
    <V2Card title="Your goals" action={<CardLink href="/affiliate/v2/goals">View all</CardLink>} className={className}>
      <div className="flex items-center gap-3 rounded-xl border bg-background/30 p-3">
        <TierBadge style="gold" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{goal.title}</p>
          <p className="text-xs text-muted-foreground">{goal.description}</p>
          <Bar value={goal.progress} label={goal.title} className="mt-2 h-1.5" />
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums">
          {goal.value}/{goal.target}
        </span>
      </div>
      <p className="mt-3 mb-1 text-xs font-semibold text-muted-foreground">Active challenges</p>
      {challenges.map((c) => (
        <GoalRow key={c.key} g={c} compact />
      ))}
    </V2Card>
  )
}

// --- Achievements --------------------------------------------------------------------------------

const ACH_ICONS: Record<Achievement["icon"], LucideIcon> = { referral: UserPlus, customer: Users, money: CircleDollarSign, clicks: MousePointerClick, payout: Banknote, tier: Trophy }

export function AchievementBadge({ a, size = "md" }: { a: Achievement; size?: "md" | "lg" }) {
  const Icon = ACH_ICONS[a.icon]
  const unlocked = a.state === "unlocked"
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border-2",
        size === "lg" ? "size-16" : "size-12",
        unlocked ? cn("bg-gradient-to-br text-white shadow-[0_0_22px_-6px_rgb(139_92_246/0.8)]", a.style ? TIER_TINT[a.style] : "from-[var(--v2-violet)] to-[var(--v2-blue)]", "border-white/20") : "border-dashed bg-muted/50 text-muted-foreground"
      )}
      aria-hidden
    >
      <Icon className={size === "lg" ? "size-7" : "size-5"} />
    </span>
  )
}

export function AchievementsPreview({ items, className }: { items: Achievement[]; className?: string }) {
  const shown = [...items].sort((a, b) => Number(b.state === "unlocked") - Number(a.state === "unlocked") || b.progress - a.progress).slice(0, 4)
  return (
    <V2Card title="Achievements" action={<CardLink href="/affiliate/v2/achievements">View all</CardLink>} className={className}>
      <ul className="grid grid-cols-4 gap-2">
        {shown.map((a) => (
          <li key={a.key} className="flex flex-col items-center gap-1.5 text-center">
            <AchievementBadge a={a} />
            <span className="text-[11px] leading-tight font-medium">{a.title}</span>
          </li>
        ))}
      </ul>
    </V2Card>
  )
}
