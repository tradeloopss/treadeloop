import type React from "react"
import type { Metadata } from "next"

// The affiliate program lives outside the (app) group on purpose: an affiliate
// doesn't have to be a subscriber, so the subscription paywall there must not
// apply. Access is decided by lib/affiliates/guard instead.
export const metadata: Metadata = {
  title: { default: "Affiliate Program — TradeLoop", template: "%s — TradeLoop Affiliates" },
  robots: { index: false, follow: false },
}

export default function AffiliateRootLayout({ children }: { children: React.ReactNode }) {
  return children
}
