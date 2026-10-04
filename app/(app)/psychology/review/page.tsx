import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { fmtMoney } from "@/lib/edge/core"
import type { SearchParams } from "@/lib/edge/page"
import { profile, timeline, weeklyReport, type WeekLine } from "@/lib/psych/engine"
import { psychPage } from "@/lib/psych/page"
import { emotionLabel } from "@/lib/psych/rules"
import { NotEnough, Section, toneClass } from "@/components/insights/ui"

const show = (v: number | null, unit: WeekLine["unit"]) => (v == null ? "—" : unit === "/10" ? `${v.toFixed(1)} / 10` : String(Math.round(v)))

// The week against the one before, the last two months day by day, and the
// trader's profile — all from the whole history, not the page's date range.
export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const { loaded, checkins, today } = await psychPage(searchParams)
  const trades = loaded.all
  const week = weeklyReport(trades, checkins, today)
  const days = timeline(trades, checkins, 60).filter((d) => d.trades > 0 || d.confidence != null || d.stress != null || d.emotion != null)
  const traits = profile(trades, checkins)
  const answers = checkins.filter((c) => c.kind === "evening" && c.answers && Object.keys(c.answers).length > 0).slice(-5).reverse()

  return (
    <>
      <Section title="This week" description={`${week.from} to ${week.to}, against the week before. ${week.trades} ${week.trades === 1 ? "trade" : "trades"} so far.`}>
        {week.trades === 0 && week.lines.every((l) => l.now == null) ? (
          <NotEnough title="Nothing to report yet this week">Trade, check in or review a trade and the week fills in.</NotEnough>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="py-1.5 text-start font-medium">
                      Measure
                    </th>
                    <th scope="col" className="py-1.5 ps-3 text-end font-medium">
                      This week
                    </th>
                    <th scope="col" className="py-1.5 ps-3 text-end font-medium">
                      Last week
                    </th>
                    <th scope="col" className="py-1.5 ps-3 text-end font-medium">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {week.lines.map((l) => {
                    const diff = l.now != null && l.before != null ? l.now - l.before : null
                    const good = diff == null || Math.abs(diff) < 0.05 ? null : (diff > 0) === (l.better === "up")
                    const Icon = diff == null || Math.abs(diff) < 0.05 ? Minus : diff > 0 ? ArrowUp : ArrowDown
                    return (
                      <tr key={l.key}>
                        <th scope="row" className="py-1.5 text-start font-normal">
                          {l.label}
                        </th>
                        <td className="py-1.5 ps-3 text-end font-medium tabular-nums">{show(l.now, l.unit)}</td>
                        <td className="py-1.5 ps-3 text-end text-muted-foreground tabular-nums">{show(l.before, l.unit)}</td>
                        <td className="py-1.5 ps-3 text-end">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${good === true ? "text-[var(--gain)]" : good === false ? "text-[var(--loss)]" : "text-muted-foreground"}`}>
                            <Icon className="size-3.5" aria-hidden />
                            {good === true ? "Better" : good === false ? "Worse" : diff == null ? "No comparison" : "Same"}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["Biggest improvement", week.improvement],
                  ["Biggest problem", week.problem],
                ] as const
              ).map(([title, item]) => (
                <div key={title} className="rounded-lg border p-3">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
                  <p className="mt-1 text-sm font-medium">{item?.text ?? "Nothing stands out."}</p>
                  {item?.detail && <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Timeline" description="The last 60 days: what you made, how cleanly you traded and how you said you felt.">
        {days.length === 0 ? (
          <NotEnough title="No days to show yet">Days appear here as you trade and check in.</NotEnough>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  {["Day", "Trades", "Result", "Clean", "Feeling", "Confidence", "Stress"].map((h, i) => (
                    <th key={h} scope="col" className={i ? "py-1.5 ps-3 text-end font-medium" : "py-1.5 text-start font-medium"}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...days].reverse().map((d) => (
                  <tr key={d.day}>
                    <th scope="row" className="py-1.5 text-start font-medium tabular-nums">
                      {d.day}
                    </th>
                    <td className="py-1.5 ps-3 text-end tabular-nums">{d.trades || "—"}</td>
                    <td className={`py-1.5 ps-3 text-end font-medium tabular-nums ${toneClass(d.trades ? d.pnl : null)}`}>{d.trades ? fmtMoney(d.pnl) : "—"}</td>
                    <td className="py-1.5 ps-3 text-end tabular-nums">{d.clean == null ? "—" : `${d.clean}%`}</td>
                    <td className="py-1.5 ps-3 text-end">{d.emotion ? emotionLabel(d.emotion) : "—"}</td>
                    <td className="py-1.5 ps-3 text-end tabular-nums">{d.confidence == null ? "—" : d.confidence.toFixed(0)}</td>
                    <td className="py-1.5 ps-3 text-end tabular-nums">{d.stress == null ? "—" : d.stress.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Your trading profile" description="Tendencies in how you trade, each from the figures beside it. A description of your trading, not of you.">
        <ul className="grid gap-3 md:grid-cols-2">
          {traits.map((t) => (
            <li key={t.key} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{t.label}</p>
                <span className="text-sm font-semibold tabular-nums">{t.value == null ? "—" : Math.round(t.value)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                {t.value != null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, t.value))}%` }} />}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{t.value == null ? `Not enough data yet. ${t.note}` : t.note}</p>
            </li>
          ))}
        </ul>
      </Section>

      {answers.length > 0 && (
        <Section title="Your end-of-day notes" description="The latest five.">
          <ul className="divide-y">
            {answers.map((c) => (
              <li key={c.id} className="py-2.5">
                <p className="text-xs font-medium text-muted-foreground tabular-nums">{c.day}</p>
                <dl className="mt-1 space-y-1 text-sm">
                  {Object.entries(c.answers ?? {}).map(([k, v]) => (
                    <div key={k}>
                      <dt className="inline text-muted-foreground">{k === "best" ? "Best moment" : k === "challenge" ? "Biggest challenge" : k === "change" ? "Change tomorrow" : k}: </dt>
                      <dd className="inline">{v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
