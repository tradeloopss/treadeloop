"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Share2 } from "lucide-react"
import { CopyField } from "./copy"

// The affiliate's main referral link, ready to copy or hand to the device's
// share sheet (where the browser has one).
// `coupon`: their permanent discount code, when they have one.
export function ReferralLinkCard({ url, code, rate, cookieDays, coupon }: { url: string; code: string; rate: number; cookieDays: number; coupon?: { code: string; percent: number; months: number } | null }) {
  const [canShare, setCanShare] = useState(false)
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), [])
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Your referral link</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Earn {rate}% on every payment from customers who sign up within {cookieDays} days of clicking it.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs">{code}</span>
      </div>
      <CopyField value={url} label="Your referral link" className="mt-4" />
      <div className="mt-3 flex flex-wrap gap-2">
        {canShare && (
          <button type="button" onClick={() => void navigator.share({ title: "TradeLoop", text: "The trading journal I use:", url }).catch(() => {})} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted">
            <Share2 className="size-3.5" aria-hidden /> Share
          </button>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted">
          <ExternalLink className="size-3.5" aria-hidden /> Open link
        </a>
      </div>
      {coupon && (
        <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-semibold">Your discount code</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            New customers get {coupon.percent}% off their first {coupon.months === 1 ? "month" : `${coupon.months} months`} with this code, and anyone who pays with it is credited to you — even without a link click.
          </p>
          <CopyField value={coupon.code} label="Your discount code" className="mt-3 max-w-sm" />
        </div>
      )}
    </section>
  )
}
