"use client"

import { Check, ShieldCheck } from "lucide-react"
import { useT } from "@/components/locale-provider"

// Only claims the code backs: live sources re-check about every minute
// (Rithmic/MT5 via the sync server; TradingView while it's open in a paired
// browser); sync only ever reads — MetaTrader even connects with the read-only
// investor password, and saved passwords are AES-256-GCM encrypted
// (lib/crypto); imports skip trades already on file (broker ids).
const POINTS = [
  { title: "Automatic imports", body: "Live connections check for new trades about every minute." },
  { title: "Read-only by design", body: "We only read your history — never place or change orders. Saved passwords are encrypted." },
  { title: "Duplicate protection", body: "Trades already in your journal are never imported twice." },
]

export function SecurityCard() {
  const t = useT()
  return (
    <section aria-labelledby="security-card-title" className="@container/sec rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-5">
      <h2 id="security-card-title" className="flex items-start gap-2.5 text-[15px] leading-6 font-semibold text-foreground">
        <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden />
        {t("How TradeLoop keeps your journal current")}
      </h2>
      {/* Stacked in the side column; three across when the card is wide. */}
      <ul className="mt-4 grid gap-4 @[720px]/sec:grid-cols-3 @[720px]/sec:gap-6">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" strokeWidth={3} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{t(p.title)}</p>
              <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">{t(p.body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
