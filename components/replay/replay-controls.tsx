"use client"

import { Play, Pause, SkipBack, SkipForward, RotateCcw, CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { TIMEFRAMES } from "@/lib/market-data/types"
import { REPLAY_SYMBOLS } from "@/lib/replay/mock"
import type { ReplayMode } from "@/lib/replay/types"

export const SESSIONS = ["00:00 - 24:00", "08:00 - 12:00", "09:00 - 16:00", "13:00 - 20:00", "14:30 - 21:00"]
export const SPEEDS = [0.25, 0.5, 1, 2, 4]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function ReplayControls({
  symbol,
  onSymbol,
  timeframe,
  onTimeframe,
  dateISO,
  onDate,
  session,
  onSession,
  mode,
  onMode,
  speed,
  onSpeed,
  playing,
  onPlayPause,
  onNext,
  onPrev,
  onReset,
  atStart,
  atEnd,
}: {
  symbol: string
  onSymbol: (v: string) => void
  timeframe: string
  onTimeframe: (v: string) => void
  dateISO: string
  onDate: (v: string) => void
  session: string
  onSession: (v: string) => void
  mode: ReplayMode
  onMode: (v: ReplayMode) => void
  speed: number
  onSpeed: (v: number) => void
  playing: boolean
  onPlayPause: () => void
  onNext: () => void
  onPrev: () => void
  onReset: () => void
  atStart: boolean
  atEnd: boolean
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(20,21,42,0.03)]">
      <Field label="Symbol">
        <Select value={symbol} onValueChange={(v) => v && onSymbol(v)}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPLAY_SYMBOLS.map((s) => (
              <SelectItem key={s.symbol} value={s.symbol}>
                {s.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Timeframe">
        <Select value={timeframe} onValueChange={(v) => v && onTimeframe(v)}>
          <SelectTrigger className="h-9 w-[92px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.filter((t) => ["1m", "5m", "15m", "30m", "1h"].includes(t.id)).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Date">
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="date" value={dateISO} onChange={(e) => onDate(e.target.value)} className="h-9 w-[150px] ps-8" />
        </div>
      </Field>

      <Field label="Session">
        <Select value={session} onValueChange={(v) => v && onSession(v)}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SESSIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Mode">
        <Select value={mode} onValueChange={(v) => v && onMode(v as ReplayMode)}>
          <SelectTrigger className="h-9 w-[112px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="practice">Practice</SelectItem>
            <SelectItem value="single">Single</SelectItem>
            <SelectItem value="all">All accounts</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Speed">
        <Select value={String(speed)} onValueChange={(v) => v && onSpeed(Number(v))}>
          <SelectTrigger className="h-9 w-[76px]">
            <SelectValue>{(v: string) => `${v}x`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Replay transport */}
      <div className="ms-auto flex items-center gap-1.5">
        <Button variant="outline" size="icon" className="size-9" onClick={onPrev} disabled={atStart} aria-label="Previous candle">
          <SkipBack className="size-4" />
        </Button>
        <Button onClick={onPlayPause} disabled={atEnd} className="h-9 gap-1.5 rounded-full px-4 hover:bg-primary/90" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button variant="outline" size="icon" className="size-9" onClick={onNext} disabled={atEnd} aria-label="Next candle">
          <SkipForward className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-9 text-muted-foreground hover:text-foreground")}
          onClick={onReset}
          aria-label="Reset replay"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </div>
  )
}
