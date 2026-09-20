import type React from "react"
import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  action,
  sticky,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  // Keeps the header (and its actions) pinned to the top of the scroll area
  // as the page scrolls — used where the header holds controls the trader
  // reaches for while reading down the page.
  sticky?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5",
        sticky && "sticky top-0 z-20 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/75",
      )}
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
