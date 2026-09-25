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

function ProBadge() {
  const t = useT()
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-primary/30 px-2 text-[11px] font-semibold text-primary">
      <Lock className="size-3" aria-hidden /> {t("Pro")}
    </span>
  )
}

export function PlatformCard({
  icon,
  name,
  description,
  badge,
  pro,
  selected,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode
  name: string
  description: string
  badge: PlatformBadge
  pro?: boolean // needs a Pro plan and the viewer isn't on one
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-start transition-[background-color,border-color,transform,box-shadow] duration-150 ease-out @[480px]/ws:min-h-[76px] @[480px]/ws:py-3",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:-translate-y-px hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-[0_4px_12px_rgba(20,21,42,0.05)]",
        selected && "border-primary bg-primary/[0.03] ring-[0.5px] ring-primary",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] @[480px]/ws:size-10 @[480px]/ws:rounded-[10px]">{icon}</span>
      <span className="min-w-0 flex-1">
        {/* Name left, status top-right; a narrow card wraps the status under the name. */}
        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {pro && <ProBadge />}
            <Badge kind={badge} />
          </span>
        </span>
        {/* Phones get a compact row (name + status); the description from 480px. */}
        <span className="mt-0.5 hidden text-xs leading-[18px] text-muted-foreground @[480px]/ws:block">{description}</span>
      </span>
      {!disabled && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />}
    </button>
  )
}
