"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Clock, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { daysUntil } from "@/lib/cases/types"

// The prize-code block: the code with a copy button, the valid-until date and
// a live "expires in N days" indicator that warns as the deadline nears.
export function PrizeCode({ code, expiresAt, status }: { code: string; expiresAt: string; status?: "active" | "used" | "expired" | "revoked" }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [, force] = useState(0)

  // Re-render hourly so the countdown stays roughly current on a long session.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const days = daysUntil(expiresAt)
  const expired = status === "expired" || (status !== "used" && status !== "revoked" && days === 0 && new Date(expiresAt).getTime() <= Date.now())
  const until = new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  const warn = !expired && days <= 2

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wider text-white/50 uppercase">{t("Your prize code")}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 font-mono text-lg font-bold tracking-wider text-white">{code}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={t("Copy code")}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-semibold text-neutral-900 transition-transform hover:scale-[1.02]"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          <span className="hidden sm:inline">{copied ? t("Copied") : t("Copy")}</span>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-white/50">
          {t("Valid until")} <span className="font-medium text-white/80">{until}</span>
        </span>
        {status === "used" ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400"><Check className="size-3.5" /> {t("Used")}</span>
        ) : status === "revoked" ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-white/50">{t("Revoked")}</span>
        ) : expired ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-red-400"><AlertTriangle className="size-3.5" /> {t("Expired")}</span>
        ) : (
          <span className={cn("inline-flex items-center gap-1.5 font-semibold", warn ? "text-amber-400" : "text-white/70")}>
            {warn ? <AlertTriangle className="size-3.5" /> : <Clock className="size-3.5" />}
            {days <= 1 ? t("Expires in 1 day") : t("Expires in {n} days", { n: days })}
          </span>
        )}
      </div>
    </div>
  )
}
