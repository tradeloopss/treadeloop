import { Award, Check, Crown, FlaskConical, Gem, Headset, Infinity as InfinityIcon, Lock, Percent, Star, TicketPercent, TrendingUp, Users, type LucideIcon } from "lucide-react"
import { TIER_PERKS, tierHasPerk, type TierPerk, type TierRow, type TierStyle } from "@/lib/affiliates/engine"
import { cn } from "@/lib/utils"

// The program's tiers as cards: what each asks for, what it pays, and what it
// unlocks — read from the live tiers, so the cards can't drift from what the
// commission engine does. With `currentId` the affiliate's own tier is marked
// and the ones above it show how far away they are.

// One accent per card style; mid-tones that read on a light and a dark page.
const ACCENT: Record<TierStyle, string> = { plain: "var(--primary)", bronze: "#c2703d", silver: "#7f8ea8", gold: "#d39a12", diamond: "#6d5ef5" }

const PERK_ICON: Record<TierPerk, LucideIcon> = { coupon: TicketPercent, beta: FlaskConical, freeAccount: InfinityIcon, prioritySupport: Headset }

const perkText = (perk: TierPerk, couponPercent: number): React.ReactNode => {
  if (perk === "coupon") {
    return (
      <>
        Personalized <span className="font-semibold text-foreground">{couponPercent}% off</span> coupon code for your audience
      </>
    )
  }
  if (perk === "beta") return "Beta feature access"
  if (perk === "freeAccount") return "Free-forever TradeLoop account"
  return "Priority access to support & feature requests"
}

function Row({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tier)]/12 text-[var(--tier)]">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {children}
      </div>
    </div>
  )
}

export function TierCards({ tiers, couponPercent, currentId = null, customers = 0, className }: { tiers: TierRow[]; couponPercent: number; currentId?: number | null; customers?: number; className?: string }) {
  const list = tiers.filter((t) => t.enabled).sort((a, b) => a.minCustomers - b.minCustomers || a.id - b.id)
  if (list.length === 0) return null
  const currentAt = list.findIndex((t) => t.id === currentId)

  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", list.length >= 4 ? "xl:grid-cols-4" : list.length === 3 ? "xl:grid-cols-3" : "", className)}>
      {list.map((t, i) => {
        const prev = i > 0 ? list[i - 1] : null
        // "Everything in Silver": the tier below unlocks something, and this one unlocks all of it.
        const inherits = !!prev && TIER_PERKS.some((k) => tierHasPerk(prev, k)) && TIER_PERKS.every((k) => !tierHasPerk(prev, k) || tierHasPerk(t, k))
        const own = TIER_PERKS.filter((k) => tierHasPerk(t, k) && !(inherits && tierHasPerk(prev, k)))
        const isCurrent = t.id === currentId
        const reached = currentAt >= 0 && i < currentAt
        const away = currentId != null && !isCurrent && !reached ? Math.max(0, t.minCustomers - customers) : 0
        const scheduled = t.introMonths != null
        const top = i === list.length - 1 && list.length > 1
        const Badge = t.style === "diamond" ? Gem : Award

        return (
          <li
            key={t.id}
            style={{ "--tier": ACCENT[t.style ?? "plain"] } as React.CSSProperties}
            className={cn("relative flex flex-col rounded-xl border bg-card p-5", isCurrent ? "border-[var(--tier)] ring-1 ring-[var(--tier)]" : "border-[var(--tier)]/35")}
            aria-current={isCurrent ? "true" : undefined}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--tier)]/15 text-[var(--tier)] ring-1 ring-[var(--tier)]/40">
                <Badge className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-bold uppercase tracking-wide">{t.name}</h3>
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--tier)]">Tier</p>
              </div>
            </div>
            {/* On the card's top edge, so the name always has the full row. */}
            {isCurrent ? (
              <span className="absolute -top-2.5 end-4 rounded-full bg-[var(--tier)] px-2 py-0.5 text-[11px] font-semibold text-white">Your tier</span>
            ) : reached ? (
              <span className="absolute -top-2.5 end-4 flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Check className="size-3" aria-hidden /> Reached
              </span>
            ) : null}

            <div className="mt-3 divide-y border-t">
              <Row icon={Users} label="Referrals required">
                <p className="text-xl font-semibold tabular-nums tracking-tight">{t.minCustomers.toLocaleString("en-US")}</p>
                <p className="text-xs text-muted-foreground">{t.minCustomers === 1 ? "customer" : "customers"}</p>
              </Row>
              <Row icon={Percent} label="Commission">
                <p className="text-xl font-semibold tabular-nums tracking-tight">{t.ratePercent}%</p>
                {scheduled ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      for {t.introMonths} month{t.introMonths === 1 ? "" : "s"}
                    </p>
                    {t.afterPercent != null && t.afterPercent > 0 && (
                      <p className="text-xs text-muted-foreground">
                        → <span className="font-semibold text-foreground">{t.afterPercent}%</span> lifetime
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">per sale</p>
                )}
              </Row>
            </div>

            {(inherits || own.length > 0 || t.tagline) && (
              <ul className="flex flex-col gap-2.5 border-t pt-3.5 text-[13px] leading-snug text-muted-foreground">
                {inherits && prev && (
                  <li className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--tier)]/12 text-[var(--tier)]">{top ? <Crown className="size-3.5" aria-hidden /> : <Star className="size-3.5" aria-hidden />}</span>
                    Everything in {prev.name}
                  </li>
                )}
                {own.map((k) => {
                  const Icon = PERK_ICON[k]
                  return (
                    <li key={k} className="flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--tier)]/12 text-[var(--tier)]">
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <span>{perkText(k, couponPercent)}</span>
                    </li>
                  )
                })}
                {t.tagline && (
                  <li className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--tier)]/12 text-[var(--tier)]">
                      <TrendingUp className="size-3.5" aria-hidden />
                    </span>
                    <span>{t.tagline}</span>
                  </li>
                )}
              </ul>
            )}

            {away > 0 && (
              <p className="mt-auto flex items-center gap-1.5 pt-4 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> {away.toLocaleString("en-US")} more paying customer{away === 1 ? "" : "s"}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
