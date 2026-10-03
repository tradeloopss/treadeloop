"use client"

import type React from "react"
import { useEffect, useRef } from "react"
import { ArrowRight, Zap } from "lucide-react"
import { RequestPayout, type RequestPayoutProps } from "@/components/affiliate/request-payout-dialog"
import { money } from "@/lib/affiliates/types"
import { appHref } from "@/lib/urls"
import { cn } from "@/lib/utils"

// "Available to withdraw": the payout pages' banner. Always the dark, glowing
// card of the design — on a light page too — with the amount, when a payout
// arrives, and one wide button that opens the Request Payout window (the same
// server-checked window as everywhere else; this is only what opens it).
// Without `request` it is the amount alone ("Available for Payout" on the V2
// Payout page, where the request form sits right under it): no button, a
// shorter card, and `note` — the minimum payout — in the button's place.

// The wallet-and-coins artwork (public/art). Asked for from the app's own
// address: on the affiliate subdomain a root-relative file takes a redirect.
const ART = appHref("/art/payout-wallet.webp")

// The artwork fades into the card on its left and along its bottom edge, and
// is shown at reduced strength (opacity-55 on both <img>s) so the amount and
// the button stay the first things read.
const MASK = "linear-gradient(to right, transparent, #000 30%), linear-gradient(to top, transparent, #000 14%)"
const FADE = { maskImage: MASK, maskComposite: "intersect", WebkitMaskImage: MASK, WebkitMaskComposite: "source-in" } as const
// On a phone the card is kept short: the artwork sits behind the amount, at
// the top right, and fades out sooner so the figure stays clean.
const MASK_PHONE = "linear-gradient(to right, transparent, #000 46%), linear-gradient(to top, transparent, #000 22%)"
const FADE_PHONE = { maskImage: MASK_PHONE, maskComposite: "intersect", WebkitMaskImage: MASK_PHONE, WebkitMaskComposite: "source-in" } as const

// Faint candlesticks in the corner, like the design's backdrop.
const CANDLES = [
  [8, 62, 30, 18],
  [22, 40, 44, 26],
  [36, 52, 26, 14],
  [50, 30, 52, 34],
  [64, 46, 30, 16],
  [78, 22, 60, 40],
  [92, 38, 34, 20],
  [106, 14, 66, 46],
  [120, 30, 40, 24],
  [134, 8, 70, 50],
] as const

function OpenOnce({ open, when }: { open: () => void; when: boolean }) {
  const done = useRef(false)
  useEffect(() => {
    if (when && !done.current) {
      done.current = true
      open()
    }
  }, [when, open])
  return null
}

export function AvailableToWithdrawCard({
  request,
  amount,
  arrival,
  status,
  autoOpen = false,
  label = "Available to withdraw",
  note,
  className,
}: {
  request?: RequestPayoutProps
  amount: number
  // "Arrives in 2–5 business days" — from the program's own settings
  arrival: string
  // a payout already on its way, or the next automatic one
  status?: string | null
  // open the window straight away (?withdraw=1)
  autoOpen?: boolean
  label?: string
  // shown along the bottom when there is no button
  note?: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={label}
      className={cn("relative isolate overflow-hidden rounded-[22px] border border-white/10 bg-[#08102a] text-white shadow-[0_22px_60px_-28px_rgba(99,70,255,0.7)]", className)}
    >
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#08102a_0%,#0a1238_48%,#051654_100%)]" />
      <div aria-hidden className="absolute -bottom-24 -start-20 -z-10 size-[300px] rounded-full bg-[radial-gradient(circle,rgba(104,40,235,0.72),transparent_66%)] sm:-bottom-28 sm:-start-24 sm:size-[440px]" />
      <svg aria-hidden viewBox="0 0 150 90" className="absolute start-3 bottom-[5.25rem] -z-10 hidden h-24 w-56 opacity-[0.13] sm:block" preserveAspectRatio="none">
        {CANDLES.map(([x, top, body, wick]) => (
          <g key={x} fill="#8b7bff">
            <rect x={x + 3.2} y={top - wick / 3} width="1.2" height={body + wick} rx="0.6" />
            <rect x={x} y={top} width="7.6" height={body} rx="1.2" />
          </g>
        ))}
      </svg>
      {/* From sm up the artwork sits behind the content, filling the card above the button. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ART} alt="" aria-hidden width={1252} height={456} decoding="async" className={cn("pointer-events-none absolute end-0 top-0 -z-10 hidden w-auto max-w-none opacity-55 select-none sm:block", request ? "h-[calc(100%-4.5rem)]" : "h-full")} style={FADE} />
      {/* On a phone: smaller, behind the amount. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ART} alt="" aria-hidden width={1252} height={456} decoding="async" className="pointer-events-none absolute -end-6 top-1 -z-10 h-[112px] w-auto max-w-none opacity-55 select-none sm:hidden" style={FADE_PHONE} />

      <div className={cn("flex flex-col p-4 sm:p-7", request ? "sm:min-h-[clamp(300px,25vw,372px)]" : "sm:min-h-[212px]")}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 sm:gap-y-3">
          <div className="min-w-0">
            <p className="text-[13px] text-white/70 sm:text-lg">{label}</p>
            <p className="mt-0.5 text-[34px] leading-none font-bold tracking-tight tabular-nums sm:mt-1.5 sm:text-[56px]">{money(amount)}</p>
            {status && <p className="mt-2 inline-flex max-w-full items-center rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/85 sm:mt-2.5">{status}</p>}
          </div>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#101a45]/70 py-1 ps-1 pe-3 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md sm:py-2 sm:ps-2 sm:pe-4 sm:text-[15px]">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4f6bff,#7c3aed)] sm:size-7" aria-hidden>
              <Zap className="size-3 fill-white stroke-white sm:size-3.5" />
            </span>
            {arrival}
          </p>
        </div>

        {request ? (
          <div className="relative mt-auto pt-3.5 sm:pt-6">
            <RequestPayout
              {...request}
              trigger={(open, hint) => (
                <>
                  <button
                    type="button"
                    onClick={() => open()}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(90deg,#8b3dff_0%,#5d5bf7_45%,#1f7bff_100%)] text-[15px] font-semibold sm:h-14 sm:rounded-2xl sm:text-base text-white shadow-[0_14px_34px_-14px_rgba(84,92,255,0.9)] transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none active:translate-y-px motion-reduce:transition-none"
                  >
                    Request Payout <ArrowRight className="size-5" aria-hidden />
                  </button>
                  {hint && <p className="mt-2 text-center text-xs text-white/70">{hint}</p>}
                  <OpenOnce open={open} when={autoOpen} />
                </>
              )}
            />
          </div>
        ) : note ? (
          <div className="relative mt-auto pt-3.5 text-[13px] text-white/75 sm:pt-6 sm:text-sm">{note}</div>
        ) : null}
      </div>
    </section>
  )
}
