"use client"

import { useState } from "react"
import { Monitor, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"

export type EmailPreview = { id: string; name: string; from: string; subject: string; preview: string; html: string }

// Every transactional email, rendered with sample data. Nothing here sends:
// the frame only displays the HTML a real email would carry.
export function EmailPreviews({ previews }: { previews: EmailPreview[] }) {
  const [id, setId] = useState(previews[0]?.id ?? "")
  const [phone, setPhone] = useState(false)
  const current = previews.find((p) => p.id === id) ?? previews[0]
  if (!current) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      <div role="tablist" aria-label="Email templates" aria-orientation="vertical" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
        {previews.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === current.id}
            onClick={() => setId(p.id)}
            className={cn("shrink-0 rounded-lg border px-3 py-2 text-start text-sm transition-colors", p.id === current.id ? "border-primary bg-primary/8 font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <dl className="min-w-0 text-sm">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">From</dt>
              <dd className="truncate font-medium">{current.from}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">Subject</dt>
              <dd className="truncate font-medium">{current.subject}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">Preview</dt>
              <dd className="truncate text-muted-foreground">{current.preview}</dd>
            </div>
          </dl>
          <div role="group" aria-label="Preview width" className="flex shrink-0 rounded-lg border p-0.5">
            {(
              [
                [false, "Desktop", Monitor],
                [true, "Phone", Smartphone],
              ] as const
            ).map(([value, text, Icon]) => (
              <button key={text} type="button" aria-pressed={phone === value} onClick={() => setPhone(value)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", phone === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-3.5" aria-hidden /> {text}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-center bg-muted/40 p-3 sm:p-5">
          {/* sandbox with no allowances: the email can't run scripts or navigate the admin */}
          <iframe key={`${current.id}-${phone}`} title={`${current.name} email preview`} sandbox="" srcDoc={current.html} className="h-[46rem] w-full rounded-lg border bg-white" style={{ maxWidth: phone ? 390 : 720 }} />
        </div>
      </div>
    </div>
  )
}
