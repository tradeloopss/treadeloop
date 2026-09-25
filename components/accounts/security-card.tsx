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
    <section aria-labelledby="security-card-title" className="@container/sec rounded-xl border border-primary/15 bg-primary/[0.03] px-4 py-4 @[480px]/page:px-5">
      <h2 id="security-card-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="size-4 text-primary" aria-hidden />
        {t("How TradeLoop keeps your journal current")}
      </h2>
      <ul className="mt-3 grid gap-3 @[720px]/sec:grid-cols-3 @[720px]/sec:gap-6">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-2.5">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-gain/15 text-gain">
              <Check className="size-3" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{t(p.title)}</p>
              <p className="text-xs leading-[18px] text-muted-foreground">{t(p.body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
