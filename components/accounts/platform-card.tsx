"use client"

import type React from "react"
import { ChevronRight, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

export type PlatformBadge = "live" | "paper" | "file" | "setup" | "soon"

const BADGE: Record<PlatformBadge, { label: string; className: string; dot?: boolean }> = {
  live: { label: "Live sync", className: "bg-gain/10 text-gain", dot: true },
  paper: { label: "Paper", className: "bg-primary/10 text-primary" },
  file: { label: "File import", className: "bg-primary/10 text-primary" },
  setup: { label: "Setting up", className: "bg-warning/15 text-warning" },
  soon: { label: "Coming soon", className: "bg-muted text-muted-foreground" },
}

export function Badge({ kind }: { kind: PlatformBadge }) {
  const t = useT()
  const b = BADGE[kind]
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap", b.className)}>
      {b.dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {t(b.label)}
    </span>
  )
}

// One platform in the Add account window's grid: logo, name, a two-line
// description and a chevron. Selecting it shows its details beside the grid;
// "Continue" goes on to connect. A plan lock shows as a small lock.
export function PlatformCard({
  icon,
  name,
  description,
  pro,
  soon,
  selected,
  onSelect,
  onOpen,
}: {
  icon: React.ReactNode
  name: string
  description: string
  pro?: boolean // the viewer's plan can't connect it
  soon?: boolean // not connectable yet
  selected?: boolean
  onSelect: () => void
  onOpen?: () => void // double-click: straight on to connecting
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      aria-pressed={selected}
      className={cn(
        "group flex min-h-[76px] w-full min-w-0 items-center gap-3.5 rounded-xl border bg-card px-4 py-3.5 text-start transition-[background-color,border-color,box-shadow] duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        selected ? "border-primary bg-primary/[0.035] ring-1 ring-primary" : "hover:border-primary/40 hover:bg-primary/[0.02]",
      )}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]", soon && "opacity-70")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate text-sm font-semibold", soon ? "text-muted-foreground" : "text-foreground")}>{name}</span>
          {pro && (
            <span title={t("Needs Pro")} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lock className="size-3" aria-hidden />
              <span className="sr-only">{t("Needs Pro")}</span>
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-[17px] text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        aria-hidden
        className={cn("size-4 shrink-0 transition-[color,transform] duration-150", selected ? "text-primary" : "text-muted-foreground/70 group-hover:translate-x-0.5 group-hover:text-primary")}
      />
    </button>
  )
}
