import type React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  action,
  sticky,
  breadcrumb,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  // Where this page sits ("Settings / Accounts"); the last item is the page.
  breadcrumb?: { label: string; href?: string }[]
  // Keeps the header (and its actions) pinned to the top of the scroll area
  // as the page scrolls — used where the header holds controls the trader
  // reaches for while reading down the page.
  sticky?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-6 sm:py-5",
        sticky && "sticky top-0 z-20 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/75",
      )}
    >
      {/* min-w-0 lets the title/description wrap within its own column so the
          action stays pinned top-right instead of dropping below it. */}
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                {item.href && i < breadcrumb.length - 1 ? (
                  <Link href={item.href} className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span className={i === breadcrumb.length - 1 ? "font-semibold text-foreground" : undefined} aria-current={i === breadcrumb.length - 1 ? "page" : undefined}>
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
