"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ClipboardCheck, Moon, Sunrise } from "lucide-react"
import { cn } from "@/lib/utils"
import { recentTrades, submitCheckin, submitDayCheckin, submitReview, submitTradeBefore } from "@/app/actions/psychology"
import { DAY_QUESTIONS, EMOTIONS, INTERFERENCE, REASONS } from "@/lib/psych/rules"
import { Sheet, useAction } from "@/components/insights/client"
import { fieldClass, linkBtn, linkBtnPrimary } from "@/components/insights/ui"

// What a trader tells Psychology. Every question is optional and a tap: the
// check-in before a trade is meant to take under ten seconds, and can always
// be skipped.

type Opt = { key: string; label: string }

export function Chips({ label, options, value, onChange, multi }: { label: string; options: readonly Opt[]; value: string | string[] | null; onChange: (v: string) => void; multi?: boolean }) {
  const on = (k: string) => (Array.isArray(value) ? value.includes(k) : value === k)
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5" role={multi ? "group" : "radiogroup"}>
        {options.map((o) => (
          <button key={o.key} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on(o.key)} onClick={() => onChange(o.key)} className={cn("min-h-9 rounded-full border px-3 text-sm font-medium transition-colors", on(o.key) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function Scale({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-baseline justify-between text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{value == null ? "Not set" : `${value} / 10`}</span>
      </legend>
      <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 10`} onClick={() => onChange(value === n ? null : n)} className={cn("h-9 rounded-md border text-xs font-semibold tabular-nums transition-colors", value === n ? "border-primary bg-primary text-primary-foreground" : value != null && n < value ? "border-primary/30 bg-primary/10" : "text-muted-foreground hover:text-foreground")}>
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  )
}

export function YesNo({ label, value, onChange, yes = "Yes", no = "No" }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void; yes?: string; no?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {(
          [
            [true, yes],
            [false, no],
          ] as const
        ).map(([v, text]) => (
          <button key={text} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(value === v ? null : v)} className={cn("h-9 rounded-md border text-sm font-medium transition-colors", value === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export type Before = { emotion: string | null; confidence: number | null; focus: number | null; stress: number | null; reason: string | null; planFollowing: boolean | null }
const EMPTY: Before = { emotion: null, confidence: null, focus: null, stress: null, reason: null, planFollowing: null }
const isEmpty = (b: Before) => Object.values(b).every((v) => v == null)

function BeforeFields({ value, set, reason = true }: { value: Before; set: (patch: Partial<Before>) => void; reason?: boolean }) {
  return (
    <>
      <Chips label="How do you feel?" options={EMOTIONS} value={value.emotion} onChange={(k) => set({ emotion: value.emotion === k ? null : k })} />
      {reason && <Chips label="Why this trade?" options={REASONS} value={value.reason} onChange={(k) => set({ reason: value.reason === k ? null : k })} />}
      {reason && <YesNo label="Is it in your plan?" value={value.planFollowing} onChange={(v) => set({ planFollowing: v })} />}
      <Scale label="Confidence" low="Unsure" high="Certain" value={value.confidence} onChange={(v) => set({ confidence: v })} />
      <Scale label="Focus" low="Distracted" high="Locked in" value={value.focus} onChange={(v) => set({ focus: v })} />
      <Scale label="Stress" low="Relaxed" high="Very stressed" value={value.stress} onChange={(v) => set({ stress: v })} />
    </>
  )
}

// The pre-trade check-in.
export function PreTradeCheckin({ className, children }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<Before>(EMPTY)
  const [tradeId, setTradeId] = useState("")
  const [trades, setTrades] = useState<{ id: number; symbol: string; side: string; at: string; open: boolean }[]>([])
  useEffect(() => {
    if (!open) return
    recentTrades()
      .then((res) => res.ok && setTrades(res.trades))
      .catch(() => {})
  }, [open])
  const close = () => {
    setOpen(false)
    setValue(EMPTY)
    setTradeId("")
  }
  return (
    <>
      <button type="button" className={className ?? linkBtnPrimary} onClick={() => setOpen(true)}>
        {children ?? (
          <>
            <ClipboardCheck className="size-3.5" />
            Pre-trade check-in
          </>
        )}
      </button>
      <Sheet
        open={open}
        onClose={close}
        title="Pre-trade check-in"
        description="Ten seconds. Answer what you like — every question is optional."
        footer={
          <>
            <button
              type="button"
              disabled={pending || isEmpty(value)}
              className={linkBtnPrimary}
              onClick={() =>
                run(
                  () => submitCheckin(value, tradeId ? Number(tradeId) : null),
                  (res) => {
                    toast.success(res.linked ? "Saved to that trade." : "Saved. It attaches to the next trade you open.")
                    close()
                    router.refresh()
                  },
                )
              }
            >
              {pending ? "Saving…" : "Save check-in"}
            </button>
            <button type="button" className={linkBtn} onClick={close}>
              Skip check-in
            </button>
          </>
        }
      >
        <BeforeFields value={value} set={(patch) => setValue((v) => ({ ...v, ...patch }))} />
        {trades.length > 0 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Which trade is this for?
            <select className={fieldClass} value={tradeId} onChange={(e) => setTradeId(e.target.value)}>
              <option value="">The next trade I open</option>
              {trades.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.symbol} {t.side} · {new Date(t.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {t.open ? " · open" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </Sheet>
    </>
  )
}

export type TradeMind = { id: number; symbol: string; side: string; pnl: number; before: Before; emotionAfter: string | null; planFollowed: boolean | null; interference: string[]; notes: string | null }

// One trade: how the trader went into it, and how it went.
export function TradeMindSheet({ trade, onClose }: { trade: TradeMind | null; onClose: () => void }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [before, setBefore] = useState<Before>(EMPTY)
  const [after, setAfter] = useState<{ emotionAfter: string | null; planFollowed: boolean | null; interference: string[]; notes: string }>({ emotionAfter: null, planFollowed: null, interference: [], notes: "" })
  const [touchedBefore, setTouchedBefore] = useState(false)
  useEffect(() => {
    if (!trade) return
    setBefore(trade.before)
    setAfter({ emotionAfter: trade.emotionAfter, planFollowed: trade.planFollowed, interference: trade.interference, notes: trade.notes ?? "" })
    setTouchedBefore(false)
  }, [trade])
  if (!trade) return null
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${trade.symbol} ${trade.side}`}
      description={`${trade.pnl >= 0 ? "+" : "−"}$${Math.abs(trade.pnl).toFixed(2)} · what was going on in your head`}
      footer={
        <>
          <button
            type="button"
            disabled={pending}
            className={linkBtnPrimary}
            onClick={() =>
              run(
                async () => {
                  if (touchedBefore && !isEmpty(before)) {
                    const first = await submitTradeBefore(trade.id, before)
                    if (!first.ok) return first
                  }
                  return submitReview(trade.id, after)
                },
                () => {
                  toast.success("Review saved.")
                  onClose()
                  router.refresh()
                },
              )
            }
          >
            {pending ? "Saving…" : "Save review"}
          </button>
          <button type="button" className={linkBtn} onClick={onClose}>
            Not now
          </button>
        </>
      }
    >
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">After the trade</p>
      <YesNo label="Did you follow your plan?" value={after.planFollowed} onChange={(v) => setAfter((a) => ({ ...a, planFollowed: v }))} />
      <Chips label="Did anything interfere?" multi options={INTERFERENCE} value={after.interference} onChange={(k) => setAfter((a) => ({ ...a, interference: a.interference.includes(k) ? a.interference.filter((x) => x !== k) : [...a.interference, k] }))} />
      <Chips label="How did you feel afterwards?" options={EMOTIONS} value={after.emotionAfter} onChange={(k) => setAfter((a) => ({ ...a, emotionAfter: a.emotionAfter === k ? null : k }))} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Notes <span className="sr-only">(optional)</span>
        <textarea className={cn(fieldClass, "h-20 resize-none py-2")} maxLength={1000} value={after.notes} onChange={(e) => setAfter((a) => ({ ...a, notes: e.target.value }))} />
      </label>
      <p className="border-t pt-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Before the trade</p>
      <BeforeFields
        value={before}
        set={(patch) => {
          setTouchedBefore(true)
          setBefore((v) => ({ ...v, ...patch }))
        }}
      />
    </Sheet>
  )
}

// Recently closed trades that haven't been reviewed: offered, never demanded.
export function ReviewList({ trades, initial }: { trades: TradeMind[]; initial?: TradeMind | null }) {
  const [current, setCurrent] = useState<TradeMind | null>(initial ?? null)
  return (
    <>
      {trades.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting. Trades from the last seven days appear here until you review them.</p>
      ) : (
        <ul className="divide-y">
          {trades.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{t.symbol}</span> <span className="text-muted-foreground">{t.side}</span>
              </span>
              <span className={cn("text-sm font-medium tabular-nums", t.pnl > 0 && "text-[var(--gain)]", t.pnl < 0 && "text-[var(--loss)]")}>
                {t.pnl >= 0 ? "+" : "−"}${Math.abs(t.pnl).toFixed(2)}
              </span>
              <button type="button" className={linkBtn} onClick={() => setCurrent(t)}>
                Review
              </button>
            </li>
          ))}
        </ul>
      )}
      <TradeMindSheet trade={current} onClose={() => setCurrent(null)} />
    </>
  )
}

export type DayValues = { emotion: string | null; confidence: number | null; focus: number | null; stress: number | null; answers: Record<string, string> }

// The morning check-in and the end-of-day review.
export function DayCheckinButton({ kind, initial, done }: { kind: "morning" | "evening"; initial: DayValues | null; done: boolean }) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [open, setOpen] = useState(false)
  const blank: DayValues = { emotion: null, confidence: null, focus: null, stress: null, answers: {} }
  const [value, setValue] = useState<DayValues>(initial ?? blank)
  const morning = kind === "morning"
  const Icon = morning ? Sunrise : Moon
  const empty = value.emotion == null && value.confidence == null && value.focus == null && value.stress == null && !Object.values(value.answers).some((a) => a.trim())
  return (
    <>
      <button type="button" className={linkBtn} onClick={() => setOpen(true)}>
        <Icon className="size-3.5" />
        {morning ? "Morning check-in" : "End-of-day review"}
        {done && <span className="text-[10px] font-semibold text-[var(--gain)] uppercase">Done</span>}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={morning ? "Morning check-in" : "End-of-day review"}
        description={morning ? "Where you are before the session starts." : "A minute on how the day went."}
        footer={
          <>
            <button
              type="button"
              disabled={pending || empty}
              className={linkBtnPrimary}
              onClick={() =>
                run(
                  () => submitDayCheckin(kind, value),
                  () => {
                    toast.success("Saved.")
                    setOpen(false)
                    router.refresh()
                  },
                )
              }
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={linkBtn} onClick={() => setOpen(false)}>
              Skip
            </button>
          </>
        }
      >
        <BeforeFields reason={false} value={{ ...EMPTY, emotion: value.emotion, confidence: value.confidence, focus: value.focus, stress: value.stress }} set={(patch) => setValue((v) => ({ ...v, ...patch }))} />
        {!morning &&
          DAY_QUESTIONS.map((q) => (
            <label key={q.key} className="flex flex-col gap-1.5 text-sm font-medium">
              {q.label}
              <textarea className={cn(fieldClass, "h-16 resize-none py-2")} maxLength={500} value={value.answers[q.key] ?? ""} onChange={(e) => setValue((v) => ({ ...v, answers: { ...v.answers, [q.key]: e.target.value } }))} />
            </label>
          ))}
      </Sheet>
    </>
  )
}
