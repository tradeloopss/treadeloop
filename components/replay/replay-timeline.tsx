"use client"

function hhmm(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(11, 16)
}

// A draggable replay cursor over the session's candles. Uses a range input so
// it's keyboard-accessible and draggable for free; ticks label the hours.
export function ReplayTimeline({ times, cursor, onSeek }: { times: number[]; cursor: number; onSeek: (time: number) => void }) {
  if (times.length === 0) return null
  const idx = Math.max(0, times.indexOf(cursor))
  const pct = times.length > 1 ? (idx / (times.length - 1)) * 100 : 0

  // One tick roughly per hour of the session, capped to keep it readable.
  const ticks: number[] = []
  const step = Math.max(1, Math.round(times.length / 8))
  for (let i = 0; i < times.length; i += step) ticks.push(i)
  if (ticks[ticks.length - 1] !== times.length - 1) ticks.push(times.length - 1)

  return (
    <div className="rounded-2xl border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(20,21,42,0.03)]">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">Replay</span>
        <span className="tabular-nums text-muted-foreground">
          {hhmm(times[idx])} / {hhmm(times[times.length - 1])}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={times.length - 1}
          value={idx}
          onChange={(e) => onSeek(times[Number(e.target.value)])}
          aria-label="Replay position"
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary,#6d4aff)] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          style={{ background: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        {ticks.map((i) => (
          <span key={i}>{hhmm(times[i])}</span>
        ))}
      </div>
    </div>
  )
}
