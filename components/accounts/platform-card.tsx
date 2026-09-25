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
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap", b.className)}>
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
  const t = useT()
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "group @container/pcard flex min-h-[68px] w-full min-w-0 items-center gap-3 rounded-[10px] border bg-card p-3 text-start transition-[background-color,border-color,transform,box-shadow] duration-150 ease-out @md:min-h-[74px] @md:gap-4 @md:p-4",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:-translate-y-px hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-[0_4px_12px_rgba(20,21,42,0.05)]",
        selected && "border-primary bg-primary/[0.03] ring-[0.5px] ring-primary",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] @md:size-11 @[560px]/pcard:size-12">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          {/* Narrow card: badges sit beside the name. */}
          <span className="contents @[460px]/pcard:hidden">
            <Badge kind={badge} />
            {pro && <ProBadge />}
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-[18px] text-muted-foreground @[460px]/pcard:max-w-[420px]">{description}</span>
      </span>
      {/* Wide card: badges on the right, beside the chevron. */}
      <span className="hidden shrink-0 items-center gap-2 @[460px]/pcard:flex">
        {pro && <ProBadge />}
        <Badge kind={badge} />
      </span>
      {!disabled && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />}
    </button>
  )
}
