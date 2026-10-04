"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Hourglass, ShieldPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { addRule } from "@/app/actions/edge-lab"
import { beginCooldown, challengeAction, stopCooldown } from "@/app/actions/psychology"
import type { Conditions } from "@/lib/edge/core"
import type { ChallengeView, CoachNote, Tilt } from "@/lib/psych/engine"
import { useAction } from "@/components/insights/client"
import { Pill, SampleTag, linkBtn, linkBtnPrimary, type PillTone } from "@/components/insights/ui"

// Turns a finding into one of the trader's rules.
export function RuleButton({ text, source, conditions, label = "Create rule", primary }: { text: string; source: "psych_pattern" | "coach"; conditions?: Conditions | null; label?: string; primary?: boolean }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      disabled={pending || done}
      className={primary ? linkBtnPrimary : linkBtn}
      onClick={() =>
        run(
          () => addRule({ text, source, conditions: conditions ?? null }),
          () => {
            setDone(true)
            toast.success("Added to your rules.")
            router.refresh()
          },
        )
      }
    >
      {done ? <Check className="size-3.5" /> : <ShieldPlus className="size-3.5" />}
      {done ? "Added" : label}
    </button>
  )
}

const remaining = (until: string) => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000))

// A cool-down the trader set for themselves. It is a reminder: nothing is locked.
export function CooldownBanner({ until }: { until: string }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [left, setLeft] = useState(() => remaining(until))
  useEffect(() => {
    const timer = setInterval(() => setLeft(remaining(until)), 20_000)
    return () => clearInterval(timer)
  }, [until])
  if (left <= 0) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--warning)]/50 bg-[var(--warning)]/10 p-3">
      <Hourglass className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Cool-down: {left} min left.</span> <span className="text-muted-foreground">You set this for yourself. Nothing is locked — it is only a reminder.</span>
      </p>
      <button type="button" disabled={pending} className={linkBtn} onClick={() => run(stopCooldown, () => router.refresh())}>
        End it now
      </button>
    </div>
  )
}

const LEVEL: Record<"low" | "elevated" | "high", { label: string; tone: PillTone }> = { low: { label: "Low", tone: "good" }, elevated: { label: "Elevated", tone: "warn" }, high: { label: "High", tone: "bad" } }

// Today's tilt risk, from what today's trades look like against the trader's usual day.
export function TiltPanel({ tilt, cooling }: { tilt: Tilt; cooling: boolean }) {
  const router = useRouter()
  const { pending, run } = useAction()
  if (!tilt) return <p className="text-sm text-muted-foreground">No trades today yet. Once you trade, this compares today with your usual day: losses in a row, pace, risk size and rule breaks.</p>
  const level = LEVEL[tilt.level]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">{tilt.score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        <Pill tone={level.tone}>{level.label}</Pill>
        <SampleTag n={tilt.trades} className="ms-auto" />
      </div>
      <ul className="space-y-2">
        {tilt.factors.map((f) => (
          <li key={f.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span>{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.note}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f.value)} aria-label={f.label}>
              <div className={cn("h-full rounded-full", f.value >= 65 ? "bg-[var(--loss)]" : f.value >= 35 ? "bg-[var(--warning)]" : "bg-[var(--gain)]")} style={{ width: `${Math.round(f.value)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {!cooling && tilt.level !== "low" && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-sm text-muted-foreground">Want a break? Optional:</span>
          {[15, 30, 60].map((m) => (
            <button key={m} type="button" disabled={pending} className={linkBtn} onClick={() => run(() => beginCooldown(m), () => router.refresh())}>
              {m} min cool-down
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type ChallengeRow = ChallengeView & { id: number | null }

export function ChallengeList({ active, available }: { active: ChallengeRow[]; available: { key: string; title: string; description: string; days: number }[] }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const act = (action: "start" | "end" | "restart", target: string | number) => run(() => challengeAction(action, target), () => router.refresh())
  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {active.map((c) => (
            <li key={c.key} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{c.title}</p>
                <Pill tone={c.done ? "good" : c.broken ? "bad" : "ok"}>{c.done ? "Completed" : c.broken ? "Broken" : "Running"}</Pill>
              </div>
              <p className="text-xs text-muted-foreground">{c.description}</p>
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={c.days} aria-valuenow={c.clean} aria-label={`${c.clean} of ${c.days} days`}>
                  <div className={cn("h-full rounded-full", c.broken ? "bg-[var(--loss)]" : "bg-primary")} style={{ width: `${Math.min(100, (c.clean / c.days) * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {c.clean} of {c.days} days{c.broken ? ` · broken on ${c.broken.day}: ${c.broken.why}` : ""}
                  {!c.measurable && " · needs reviews or check-ins to be measured"}
                </p>
              </div>
              {c.id != null && (
                <div className="mt-auto flex gap-2">
                  {(c.broken || c.done) && (
                    <button type="button" disabled={pending} className={linkBtn} onClick={() => act("restart", c.id!)}>
                      Start again
                    </button>
                  )}
                  <button type="button" disabled={pending} className={cn(linkBtn, "text-muted-foreground")} onClick={() => act("end", c.id!)}>
                    End
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <ul className="divide-y">
          {available.map((c) => (
            <li key={c.key} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.title}</p>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </div>
              <button type="button" disabled={pending} className={linkBtn} onClick={() => act("start", c.key)}>
                Start
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const PARTS: [keyof Pick<CoachNote, "correlation" | "hypothesis" | "recommendation">, string, string][] = [
  ["correlation", "Correlation", "Two things that moved together in your data. One may not cause the other."],
  ["hypothesis", "Hypothesis", "A possible explanation. It has not been tested."],
  ["recommendation", "Recommendation", "Something to try, based on the above."],
]

// The coach: each note keeps what was seen apart from what it might mean.
export function CoachNotes({ notes }: { notes: CoachNote[] }) {
  if (!notes.length) return <p className="text-sm text-muted-foreground">Nothing to point out yet. The coach speaks up when a pattern in your trades is clear enough to be worth your attention.</p>
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {notes.map((note) => (
        <li key={note.key} className="flex flex-col gap-2.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{note.title}</p>
            <SampleTag n={note.n} />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Observed</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-4 text-sm">
              {note.observed.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
          {PARTS.map(([key, label, hint]) =>
            note[key] ? (
              <div key={key}>
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase" title={hint}>
                  {label}
                </p>
                <p className="mt-0.5 text-sm">{note[key]}</p>
              </div>
            ) : null,
          )}
          {note.experiment && (
            <div className="mt-auto flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2.5">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">Experiment:</span> {note.experiment.rule}
              </p>
              <RuleButton text={note.experiment.rule} source="coach" label="Start it" />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
