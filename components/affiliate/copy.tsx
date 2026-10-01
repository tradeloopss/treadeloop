"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function CopyButton({ value, label = "Copy", className, iconOnly }: { value: string; label?: string; className?: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } else toast.error("Couldn't copy. Select the text and copy it manually.")
      }}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted", iconOnly && "w-8 justify-center px-0", className)}
    >
      {copied ? <Check className="size-3.5 text-[var(--gain)]" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {!iconOnly && <span aria-live="polite">{copied ? "Copied" : label}</span>}
    </button>
  )
}

// A read-only value with its copy button — links, codes.
export function CopyField({ value, label, className, mono = true }: { value: string; label?: string; className?: string; mono?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input readOnly value={value} aria-label={label ?? "Value"} onFocus={(e) => e.currentTarget.select()} className={cn("h-9 min-w-0 flex-1 truncate rounded-lg border border-input bg-muted/40 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", mono && "font-mono text-[13px]")} />
      <CopyButton value={value} className="h-9" />
    </div>
  )
}
