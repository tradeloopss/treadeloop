import type React from "react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { SiteFooter } from "@/components/site-footer"
import { ContactSupportTrigger } from "@/components/support/contact-support"
import { appHref } from "@/lib/urls"

export const metadata = {
  title: "TradeLoop Help Center",
  description: "Guides and how-tos for TradeLoop — connect your broker, journal trades, manage live positions and track your prop-firm rules.",
}

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3.5">
          <Link href="/help" className="flex items-center gap-2">
            <BrandMark className="size-7" alt="TradeLoop" />
            <span className="text-lg font-semibold tracking-tight">TradeLoop</span>
            <span className="ms-0.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Help</span>
          </Link>
          <nav className="ms-auto flex items-center gap-4 text-sm">
            <Link href="/help" className="hidden text-muted-foreground hover:text-foreground sm:inline">Guides</Link>
            <ContactSupportTrigger className="hidden cursor-pointer text-muted-foreground hover:text-foreground sm:inline">Contact</ContactSupportTrigger>
            <a href={appHref("/dashboard")} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Open app
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>

      <SiteFooter />
    </div>
  )
}
