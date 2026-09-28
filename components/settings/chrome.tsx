"use client"

import type React from "react"
import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type IconType = React.ComponentType<{ className?: string }>

// Thin bordered header panel at the top of every settings page: a small icon +
// UPPERCASE title on the left, status pills on the right. Compact on purpose.
export function SettingsHeader({
  icon: Icon,
  title,
  right,
}: {
  icon: IconType
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-semibold tracking-wide text-foreground uppercase">{title}</h1>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2 sm:gap-3">{right}</div>}
    </div>
  )
}

// Small status chip used in the header's right slot (2FA Off, 1 Session, …).
export function StatusPill({
  icon: Icon,
  children,
  tone = "muted",
}: {
  icon?: IconType
  children: React.ReactNode
  tone?: "muted" | "success" | "danger"
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap",
        tone === "success" && "text-[var(--gain)]",
        tone === "danger" && "text-[var(--loss)]",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  )
}

// Tiny uppercase label above a group of rows/panels.
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{children}</p>
}

// Stack of settings rows with consistent spacing.
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>
}

// One full-width settings row. If `children` is provided it becomes an
// accordion: the header toggles the inline expanded content. `tone="danger"`
// paints the icon/title/chevron in the loss color (Delete Account).
export function SettingsRow({
  icon: Icon,
  title,
  value,
  tone = "default",
  defaultOpen = false,
  children,
}: {
  icon: IconType
  title: string
  value?: React.ReactNode
  tone?: "default" | "danger"
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expandable = Boolean(children)
  const danger = tone === "danger"

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", open && expandable && "ring-1 ring-border")}>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-start transition-colors",
          expandable && "hover:bg-accent/40",
          !expandable && "cursor-default",
        )}
      >
        <Icon className={cn("size-4 shrink-0", danger ? "text-[var(--loss)]" : "text-muted-foreground")} />
        <span className={cn("text-sm font-medium", danger ? "text-[var(--loss)]" : "text-foreground")}>{title}</span>
        {value != null && <span className="truncate text-xs text-muted-foreground">{value}</span>}
        {expandable && (
          <ChevronDown
            className={cn(
              "ms-auto size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
              danger && "text-[var(--loss)]",
            )}
          />
        )}
      </button>
      {expandable && open && (
        <div className="animate-in fade-in slide-in-from-top-1 border-t px-4 py-4 duration-200 ease-out">{children}</div>
      )}
    </div>
  )
}

// Bordered panel with a small uppercase header row — used for the two
// Sessions & Activity boxes and elsewhere a titled box is needed.
export function Panel({
  title,
  right,
  children,
  className,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</p>
        {right}
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

// The All / Logins / Security style segmented filter used in panel headers.
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
            value === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
