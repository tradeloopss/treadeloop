"use client"

import { Check, ShieldCheck } from "lucide-react"
import { useT } from "@/components/locale-provider"

// Only claims the code actually backs: live sources re-check about every
// minute (Rithmic/MT5 via the sync server; TradingView while it's open in a
// paired browser), sync code only reads, passwords are AES-256-GCM encrypted
// (lib/crypto), and imports skip trades already on file (broker ids).
const ROWS = [
  { title: "Automatic imports", body: "Live connections check for new trades about every minute and add them to your journal on their own." },
  { title: "TradeLoop never trades", body: "We only read your history — TradeLoop can't place, change or close orders. MetaTrader connects with your read-only investor password." },
  { title: "Encrypted credentials", body: "Saved passwords are encrypted, and used only by our sync server." },
  { title: "Duplicate protection", body: "Trades already in your journal are never imported twice." },
]

export function SecurityCard() {
  const t = useT()
  return (
    <section aria-labelledby="security-card-title" className="rounded-xl border border-primary/15 bg-primary/[0.03] p-4">
      <h2 id="security-card-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="size-4 text-primary" aria-hidden />
        {t("How TradeLoop keeps your journal current")}
      </h2>
      <ul className="mt-3 space-y-3">
        {ROWS.map((row) => (
          <li key={row.title} className="flex gap-2.5">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-gain/15 text-gain">
              <Check className="size-3" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">{t(row.title)}</p>
              <p className="text-xs leading-[18px] text-muted-foreground">{t(row.body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
