import type React from "react"
import { BrandMark } from "@/components/brand-mark"

// The centred card used by sign-in and its follow-up screens (2FA code,
// forgot/reset password), so they all look like one flow.
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <BrandMark className="size-14" alt="TradeLoop" />
          <h1 className="mt-5 text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="mt-7">{children}</div>
      </div>
    </div>
  )
}
