"use client"

import { BrandMark } from "@/components/brand-mark"
import { ContactSupportTrigger } from "@/components/support/contact-support"
import type { SupportCategory } from "@/lib/support/request"
import { HELP_URL, affiliateHref, siteHref } from "@/lib/urls"
import { cn } from "@/lib/utils"

// The footer of every public page: the home page, pricing, brokers, the legal
// pages, the Help Center and the affiliate program. One row on a desktop,
// stacked on a phone. "Contact support" opens the Contact Support window, which
// works without an account.
//
// The links are absolute where the site has its own addresses (www, help,
// affiliate), so the footer is the same wherever it is shown.
//
// `affiliate`: on the affiliate program's pages the program's own terms take
// the place of the link to the program.
export function SiteFooter({ affiliate = false, supportCategory, className }: { affiliate?: boolean; supportCategory?: SupportCategory; className?: string }) {
  const link = "rounded outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
  const help = HELP_URL.startsWith("http") ? HELP_URL : siteHref(HELP_URL)
  return (
    <footer className={cn("border-t bg-background text-foreground", className)}>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-7 text-xs text-muted-foreground sm:px-6 lg:flex-row lg:justify-between">
        <a href={siteHref("/")} className="flex items-center gap-2 rounded-md text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <BrandMark className="size-6" />
          <span className="text-sm font-semibold tracking-tight">TradeLoop</span>
        </a>
        <p>© {new Date().getFullYear()} TradeLoop. Built for better trading.</p>
        {/* (a list, not a <nav>: the home page styles every nav as its header menu) */}
        <ul aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <li>
            <a href={siteHref("/pricing")} className={link}>
              Pricing
            </a>
          </li>
          <li>
            <a href={help} className={link}>
              Help
            </a>
          </li>
          <li>
            {affiliate ? (
              <a href={affiliateHref("/affiliate/terms")} className={link}>
                Program terms
              </a>
            ) : (
              <a href={affiliateHref("/affiliate/apply")} className={link}>
                Affiliates
              </a>
            )}
          </li>
          <li>
            <ContactSupportTrigger category={supportCategory} className={cn(link, "cursor-pointer")}>
              Contact support
            </ContactSupportTrigger>
          </li>
          <li>
            <a href={siteHref("/privacy")} className={link}>
              Privacy
            </a>
          </li>
          <li>
            <a href={siteHref("/terms")} className={link}>
              Terms
            </a>
          </li>
        </ul>
      </div>
    </footer>
  )
}
