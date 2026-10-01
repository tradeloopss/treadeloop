"use client"

import { useMemo, useState } from "react"
import { Download, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { RESOURCE_CATEGORY_LABELS } from "@/lib/affiliates/types"
import { CopyButton } from "./copy"
import { Empty } from "./ui"

export type ResourceView = { id: number; title: string; description: string | null; category: string; url: string | null; previewUrl: string | null; content: string | null }

export function ResourcesBrowser({ resources, link }: { resources: ResourceView[]; link: string }) {
  const [category, setCategory] = useState("all")
  const categories = useMemo(() => [...new Set(resources.map((r) => r.category))], [resources])
  const visible = resources.filter((r) => category === "all" || r.category === category)
  // Ready-made copy can carry {link}; it's swapped for the affiliate's own.
  const filled = (text: string) => text.split("{link}").join(link)

  if (resources.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty icon={FolderOpen} title="No resources yet">
          Logos, banners and ready-to-post copy will appear here as we publish them.
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-[3px]" role="group" aria-label="Category">
        {["all", ...categories].map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={c === category} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", c === category ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {c === "all" ? "All" : (RESOURCE_CATEGORY_LABELS[c] ?? c)}
          </button>
        ))}
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
            {r.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.previewUrl} alt="" loading="lazy" className="aspect-video w-full border-b bg-muted object-cover" />
            )}
            <div className="flex flex-1 flex-col p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{RESOURCE_CATEGORY_LABELS[r.category] ?? r.category}</p>
              <h3 className="mt-1 text-sm font-semibold">{r.title}</h3>
              {r.description && <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>}
              {r.content && <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{filled(r.content)}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {r.content && <CopyButton value={filled(r.content)} label="Copy text" />}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:bg-muted">
                    <Download className="size-3.5" aria-hidden /> Download
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
