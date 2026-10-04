import { cn } from "@/lib/utils"

// Small SVG charts, drawn on the server. Each has a text description for
// screen readers; the figures themselves are always also on the page as text.

const W = 600

function scale(values: number[], height: number, pad = 6) {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo || 1
  return { y: (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2), lo, hi }
}

// A running total. `values` in order; the zero line is drawn when it is in view.
export function LineChart({ values, height = 140, label, className }: { values: number[]; height?: number; label: string; className?: string }) {
  if (values.length < 2) return <p className="py-6 text-center text-sm text-muted-foreground">Not enough trades to draw a curve.</p>
  const { y } = scale(values, height)
  const x = (i: number) => (i / (values.length - 1)) * W
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const up = values[values.length - 1] >= values[0]
  const colour = up ? "var(--gain)" : "var(--loss)"
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("h-36 w-full", className)}>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeDasharray="4 4" className="text-border" vectorEffect="non-scaling-stroke" />
      <path d={`${path} L${W},${y(0)} L0,${y(0)} Z`} fill={colour} opacity={0.08} />
      <path d={path} fill="none" stroke={colour} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

// The spread of simulated runs: the middle half, the middle 90%, and the median.
export function BandChart({ bands, height = 180, label }: { bands: { i: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]; height?: number; label: string }) {
  if (bands.length < 2) return null
  const { y } = scale(bands.flatMap((b) => [b.p5, b.p95]), height)
  const last = bands[bands.length - 1].i || 1
  const x = (i: number) => (i / last) * W
  const area = (hi: "p95" | "p75", lo: "p5" | "p25") =>
    `${bands.map((b, k) => `${k ? "L" : "M"}${x(b.i).toFixed(1)},${y(b[hi]).toFixed(1)}`).join(" ")} ${[...bands].reverse().map((b) => `L${x(b.i).toFixed(1)},${y(b[lo]).toFixed(1)}`).join(" ")} Z`
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-44 w-full">
      <path d={area("p95", "p5")} fill="var(--primary)" opacity={0.12} />
      <path d={area("p75", "p25")} fill="var(--primary)" opacity={0.22} />
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeDasharray="4 4" className="text-border" vectorEffect="non-scaling-stroke" />
      <path d={bands.map((b, k) => `${k ? "L" : "M"}${x(b.i).toFixed(1)},${y(b.p50).toFixed(1)}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Upright bars (a distribution). Negative buckets are tinted as losses when `signed`.
export function Columns({ items, height = 110, label, signed }: { items: { label: string; n: number; negative?: boolean }[]; height?: number; label: string; signed?: boolean }) {
  const max = Math.max(1, ...items.map((b) => b.n))
  if (!items.length) return null
  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-1" style={{ height }}>
        {items.map((b, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: "100%" }} title={`${b.label}: ${b.n}`}>
            <div className={cn("w-full rounded-t", signed ? (b.negative ? "bg-[var(--loss)]/70" : "bg-[var(--gain)]/70") : "bg-primary/60")} style={{ height: `${Math.max(b.n ? 3 : 0, (b.n / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
        {items.map((b, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// Rows of horizontal bars, centred on zero: which values helped, which hurt.
export function BarRows({ rows, format }: { rows: { label: string; value: number; n: number; note?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="relative h-4 rounded bg-muted/60" aria-hidden>
            <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <span className={cn("absolute inset-y-0.5 rounded-sm", r.value >= 0 ? "left-1/2 bg-[var(--gain)]/70" : "right-1/2 bg-[var(--loss)]/70")} style={{ width: `${(Math.abs(r.value) / max) * 50}%` }} />
          </span>
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className={cn("font-medium", r.value > 0 && "text-[var(--gain)]", r.value < 0 && "text-[var(--loss)]")}>{format(r.value)}</span>
            <span className="text-[10px] text-muted-foreground">n={r.n}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
