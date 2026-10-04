import Link from "next/link"
import { MIN_PATTERN, cleanConditions, conditionsParam, fmtMoney, fmtR, type EdgeTrade, type Stats } from "@/lib/edge/core"
import { breakdown } from "@/lib/edge/discover"
import type { SearchParams } from "@/lib/edge/page"
import { listRules, ruleBreaks } from "@/lib/edge/server"
import { featureAccess } from "@/lib/features/server"
import { challengeProgress, coachNotes, dailyBrief, emotionPerformance, scores, tiltRisk } from "@/lib/psych/engine"
import { psychPage } from "@/lib/psych/page"
import { CHALLENGES } from "@/lib/psych/rules"
import { activeCooldown, challenges, latestStress, pendingReviews } from "@/lib/psych/server"
import { localDay } from "@/lib/timezone"
import { BarRows } from "@/components/insights/charts"
import { FilterBar } from "@/components/insights/client"
import { RulesList } from "@/components/insights/rules"
import { Disclaimer, Metric, NotEnough, Section, linkBtn } from "@/components/insights/ui"
import { DayCheckinButton, PreTradeCheckin, ReviewList, type TradeMind } from "@/components/psychology/checkin"
import { ChallengeList, CoachNotes, CooldownBanner, TiltPanel } from "@/components/psychology/panels"

const perTrade = (s: Stats) => (s.expR != null ? s.expR : s.expectancy)

const mind = (t: EdgeTrade): TradeMind => ({
  id: t.id,
  symbol: t.symbol,
  side: t.dims.side ?? "",
  pnl: t.pnl,
  before: { emotion: t.psych?.emotionBefore ?? null, confidence: t.psych?.confidenceBefore ?? null, focus: t.psych?.focusBefore ?? null, stress: t.psych?.stressBefore ?? null, reason: t.psych?.reason ?? null, planFollowing: t.psych?.planBefore ?? null },
  emotionAfter: t.psych?.emotionAfter ?? null,
  planFollowed: t.psych?.planFollowed ?? null,
  interference: t.psych?.interference ?? [],
  notes: null,
})

export default async function PsychologyPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId, trades, loaded, today, checkins, timeZone, sp } = await psychPage(searchParams)
  const [pending, running, rules, cooldown, stress] = await Promise.all([pendingReviews(userId), challenges(userId), listRules(userId), activeCooldown(userId), latestStress(userId, today)])

  // Edge Lab is released separately: link to it only when this trader has it.
  const canEdge = (await featureAccess()).can.edge_lab
  const s = scores(trades, checkins)
  const tilt = tiltRisk(loaded.all, today, stress)
  const brief = dailyBrief(loaded.all, today)
  const notes = trades.length >= MIN_PATTERN ? coachNotes(trades) : []
  const byId = new Map(loaded.all.flatMap((t) => [t, ...t.copies.map((id) => ({ ...t, id }))]).map((t) => [t.id, t] as const))
  const waiting = pending.flatMap((p) => (byId.has(p.id) ? [mind(byId.get(p.id)!)] : []))
  // a link from a trade ("how was my head in this one?") opens it
  const asked = Number(Array.isArray(sp.trade) ? sp.trade[0] : sp.trade)
  const opened = Number.isInteger(asked) && byId.has(asked) ? mind(byId.get(asked)!) : null

  const todays = checkins.filter((c) => c.day === today)
  const day = (kind: string) => {
    const c = todays.find((x) => x.kind === kind)
    return c ? { emotion: c.emotion, confidence: c.confidence, focus: c.focus, stress: c.stress, answers: c.answers ?? {} } : null
  }
  const active = running.map((c) => ({ ...challengeProgress(c.key as (typeof CHALLENGES)[number]["key"], localDay(c.startedAt, timeZone), loaded.all, today), id: c.id }))
  const unit = trades.some((t) => t.r != null) ? "R" : "$"
  const fmt = (v: number) => (unit === "R" ? fmtR(v) : fmtMoney(v))
  const feelings = emotionPerformance(trades)
  const states = (["confidence", "stress", "focus", "plan", "reason"] as const).map((dim) => ({ dim, rows: breakdown(trades, dim, 5) })).filter((x) => x.rows.length > 1)
  const cards: [string, number | null, string, number?][] = [
    ["Psychology", s.psychology, "Everything below, weighed together."],
    ["Emotional control", s.emotionalControl, "How rarely a loss, a win or a feeling changed how you traded next."],
    ["Discipline", s.discipline, "How often you kept to your plan, your size and your pace."],
    ["Focus", s.focus, "From your check-ins."],
    ["Confidence", s.confidence, "From your check-ins."],
    ["Stress", s.stress, "Your average answer in check-ins, from 1 (relaxed) to 10 (very stressed). Lower is calmer.", 10],
  ]

  return (
    <>
      {cooldown && <CooldownBanner until={cooldown.toISOString()} />}
      <div className="flex flex-wrap items-center gap-2">
        <PreTradeCheckin />
        <DayCheckinButton kind="morning" initial={day("morning")} done={!!day("morning")} />
        <DayCheckinButton kind="evening" initial={day("evening")} done={!!day("evening")} />
      </div>
      <FilterBar lookups={loaded.lookups} backtests={false} />

      {(brief.yesterday || brief.reminders.length > 0) && (
        <Section title="Today" description="From your last trading day and the patterns found in your trades.">
          {brief.yesterday && (
            <p className="text-sm">
              Last session ({brief.yesterday.day}): {brief.yesterday.trades} {brief.yesterday.trades === 1 ? "trade" : "trades"}, <span className={brief.yesterday.pnl > 0 ? "text-[var(--gain)]" : brief.yesterday.pnl < 0 ? "text-[var(--loss)]" : ""}>{fmtMoney(brief.yesterday.pnl)}</span>
              {brief.yesterday.clean != null && `, ${brief.yesterday.clean}% taken without a rule break`}.
            </p>
          )}
          {brief.reminders.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-sm">
              {brief.reminders.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value, help, outOf = 100]) => (
          <Metric key={label} label={label} help={help} value={value == null ? "—" : outOf === 10 ? value.toFixed(1) : Math.round(value)} sub={value == null ? "Not enough data yet" : `out of ${outOf}`} />
        ))}
      </div>
      <details className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
        <summary className="cursor-pointer font-medium">How these scores are worked out</summary>
        <p className="mt-2 text-muted-foreground">
          From {s.trades} trades, {s.reviews} reviews and {s.checkins} check-ins in this period. A part with no data is left out — it is never filled in.
        </p>
        <ul className="mt-2 divide-y">
          {s.components.map((c) => (
            <li key={c.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <span>
                {c.label} <span className="text-muted-foreground">— {c.note}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{c.value == null ? "—" : Math.round(c.value)}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Tilt risk today" description="Today against your usual day. Observed from your trades, not a judgment of you.">
          <TiltPanel tilt={tilt} cooling={!!cooldown} />
        </Section>
        <Section title="Reviews waiting" description="Thirty seconds each. They are what the plan and discipline figures are built from.">
          <ReviewList trades={waiting} initial={opened} />
        </Section>
      </div>

      <Section title="State of mind and results" description="How the average trade did in each state you reported. A correlation: it shows what went together, not what caused what.">
        {feelings.length === 0 && states.length === 0 ? (
          <NotEnough title="Not enough check-ins yet">Check in before your trades. Once a state has eight trades behind it, it appears here with what those trades made.</NotEnough>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {feelings.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Feeling before the trade</p>
                <BarRows format={fmt} rows={feelings.map((r) => ({ label: r.value, value: perTrade(r.stats), n: r.stats.n }))} />
                {canEdge && (
                  <Link href={`/edge-lab/hypotheses?c=${encodeURIComponent(conditionsParam({ emotion: feelings[0].value }))}`} className={`${linkBtn} mt-3`}>
                    Test “{feelings[0].value}” in Edge Lab
                  </Link>
                )}
              </div>
            )}
            {states.map(({ dim, rows }) => (
              <div key={dim}>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{dim === "plan" ? "Plan" : dim === "reason" ? "Reason for the trade" : dim}</p>
                <BarRows format={fmt} rows={rows.map((r) => ({ label: r.value, value: perTrade(r.stats), n: r.stats.n }))} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Coach" description="Each note keeps what was observed apart from what it might mean.">
        {trades.length < MIN_PATTERN ? (
          <NotEnough have={trades.length} need={MIN_PATTERN}>
            The coach needs {MIN_PATTERN} closed trades in the period before it says anything.
          </NotEnough>
        ) : (
          <>
            <CoachNotes notes={notes} />
            <Disclaimer kinds={["ai", "behaviour"]} />
          </>
        )}
      </Section>

      <Section title="Challenges" description="Seven days each, checked against your trades. Start one that matches a pattern you want to break.">
        <ChallengeList active={active} available={CHALLENGES.filter((c) => !running.some((r) => r.key === c.key)).map((c) => ({ key: c.key, title: c.title, description: c.description, days: c.days }))} />
      </Section>

      <RulesList rules={rules.map((r) => ({ id: r.id, text: r.text, source: r.source, active: r.active, createdAt: r.createdAt.toISOString(), breaks: r.active ? ruleBreaks(loaded.all, r.conditions ? cleanConditions(r.conditions) : null, r.createdAt.getTime()) : null }))} />
    </>
  )
}
