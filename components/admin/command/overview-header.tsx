"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, Check, ChevronDown, Loader2, Plus, RotateCw } from "lucide-react"
import { RANGE_LABELS, type RangeKey } from "@/lib/admin/command-center-rules"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { NAV_ICONS } from "@/components/admin/shell/nav-icons"
import { useAdminShell } from "@/components/admin/shell/modern-shell"
import { cn } from "@/lib/utils"

const triggerClass =
  "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"

export function OverviewHeader({ range }: { range: RangeKey }) {
  const { quickActions, openPalette } = useAdminShell()
  const router = useRouter()
  const [pending, start] = useTransition()
  const setRange = (next: RangeKey) => {
    start(() => router.push(next === "7d" ? "/admin" : `/admin?range=${next}`, { scroll: false }))
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-1 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pt-7">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Platform performance, activity and key metrics at a glance.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {quickActions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" className={cn(triggerClass, "flex-1 justify-center bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none")} />}>
              <Plus className="size-4" aria-hidden /> Quick actions <ChevronDown className="size-4 opacity-80" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-64">
              {quickActions.map((a) => {
                const Icon = NAV_ICONS[a.icon]
                return a.href ? (
                  <DropdownMenuItem key={a.key} render={<Link href={a.href} />} className="min-h-9">
                    <Icon aria-hidden /> {a.label}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={a.key} onClick={openPalette} className="min-h-9">
                    <Icon aria-hidden /> {a.label}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" disabled={pending} aria-label={`Date range: ${RANGE_LABELS[range]}`} className={cn(triggerClass, "flex-1 justify-center border bg-card hover:bg-muted sm:flex-none")} />}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarDays className="size-4 text-muted-foreground" aria-hidden />}
            {RANGE_LABELS[range]}
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-48">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
              <DropdownMenuItem key={key} onClick={() => setRange(key)} className="min-h-9">
                <Check className={cn(key === range ? "opacity-100" : "opacity-0")} aria-hidden /> {RANGE_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// Re-runs this page's server queries in place (System health, an error state).
export function RefreshButton({ label = "Refresh", className }: { label?: string; className?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60", className)}
    >
      <RotateCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden /> {label}
    </button>
  )
}

export function SectionError({ title, className }: { title: string; className?: string }) {
  return (
    <section className={cn("flex flex-col rounded-2xl border bg-card px-4 py-4 sm:px-5", className)} role="alert">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center text-sm text-muted-foreground">
        Unable to load this section.
        <RefreshButton label="Try again" className="text-sm" />
      </div>
    </section>
  )
}
