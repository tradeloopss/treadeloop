"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Check, Copy, ExternalLink, Share2 } from "lucide-react"
import { useShareLink } from "./header-tools"
import { cn } from "@/lib/utils"

export async function copyText(text: string, done = "Copied!") {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
    return true
  } catch {
    toast.error("Couldn't copy. Select the text and copy it instead.")
    return false
  }
}

// The link and its three actions. Copy copies the real URL; Share uses the
// device's share sheet where there is one, else copies.
export function ReferralLinkActions({ url, size = "md", className, showField = true }: { url: string; size?: "sm" | "md"; className?: string; showField?: boolean }) {
  const [copied, setCopied] = useState(false)
  const share = useShareLink(url)
  const btn = cn("inline-flex items-center justify-center gap-1.5 rounded-lg border bg-card/70 font-medium transition-colors hover:border-primary/40 hover:bg-primary/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", size === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3.5 text-sm")
  const copy = async () => {
    if (await copyText(url, "Referral link copied!")) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {showField && (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-background/60 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={url}>
            {url}
          </span>
          <button type="button" onClick={copy} aria-label="Copy referral link" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
            {copied ? <Check className="size-4 text-gain" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={btn}>
          {copied ? <Check className="size-4 text-gain" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => share()} className={btn}>
          <Share2 className="size-4" aria-hidden /> Share
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className={btn}>
          <ExternalLink className="size-4" aria-hidden /> Open link
        </a>
      </div>
    </div>
  )
}
