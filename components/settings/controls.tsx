"use client"

import type React from "react"
import { cn } from "@/lib/utils"

// A labelled row inside a Panel: name + optional description on the left, the
// control on the right. Compact, matching the reference's density.
export function FieldRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-2 py-2.5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

// A small on/off switch — no external dependency, theme-token colored.
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  )
}

// Button-group segmented control for a small enum.
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  size?: "sm" | "md"
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Styled native <select> — avoids the Base UI Select onValueChange typing that
// the codebase's other selects trip over, and stays compact.
export function SelectField<T extends string>({
  value,
  onChange,
  options,
  id,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  id?: string
  className?: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        "h-9 rounded-md border bg-transparent px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-popover text-popover-foreground">
          {o.label}
        </option>
      ))}
    </select>
  )
}
