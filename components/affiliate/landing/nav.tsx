"use client"

import { useState } from "react"
import { ArrowRight, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { ThemeSwitch } from "@/components/affiliate/theme-switch"
import { containerClass } from "./parts"

export type NavLink = { label: string; href: string; active?: boolean }

// The public affiliate page's header: the site's own destinations, with
// Affiliates marked as where you are. A row on a desktop, a menu on a phone.
export function AffiliateNavbar({ homeHref, links, signedIn, signInHref, signUpHref, appHref }: { homeHref: string; links: NavLink[]; signedIn: boolean; signInHref: string; signUpHref: string; appHref: string }) {
  const [open, setOpen] = useState(false)
  const primary = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40"
  const quiet = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 shadow-[0_1px_0_rgb(0_0_0/0.02)] backdrop-blur-md">
      <div className={cn(containerClass, "flex h-14 items-center gap-6")}>
        <a href={homeHref} className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <BrandMark className="size-7" />
          <span className="text-base font-semibold tracking-tight">TradeLoop</span>
        </a>

        <nav aria-label="Main" className="hidden h-full items-center gap-1 md:flex">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              aria-current={l.active ? "page" : undefined}
              className={cn(
                "relative flex h-full items-center px-3 text-sm outline-none transition-colors focus-visible:text-primary",
                l.active ? "font-medium text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1.5">
          <ThemeSwitch compact />
          <div className="hidden items-center gap-1.5 md:flex">
            {signedIn ? (
              <a href={appHref} className={primary}>
                Open app <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </a>
            ) : (
              <>
                <a href={signInHref} className={quiet}>
                  Log in
                </a>
                <a href={signUpHref} className={primary}>
                  Get Started
                </a>
              </>
            )}
          </div>
          <button type="button" aria-expanded={open} aria-controls="affiliate-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)} className="inline-flex size-9 items-center justify-center rounded-lg text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 md:hidden">
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open && (
        <div id="affiliate-menu" className="border-t bg-background md:hidden">
          <nav aria-label="Main" className={cn(containerClass, "flex flex-col gap-1 py-3")}>
            {links.map((l) => (
              <a key={l.label} href={l.href} aria-current={l.active ? "page" : undefined} onClick={() => setOpen(false)} className={cn("rounded-lg px-3 py-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40", l.active ? "bg-primary/8 font-medium text-primary" : "text-foreground/85 hover:bg-muted")}>
                {l.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-3">
              {signedIn ? (
                <a href={appHref} className={cn(primary, "col-span-2")}>
                  Open app <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                </a>
              ) : (
                <>
                  <a href={signInHref} className={cn(quiet, "border")}>
                    Log in
                  </a>
                  <a href={signUpHref} className={primary}>
                    Get Started
                  </a>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
