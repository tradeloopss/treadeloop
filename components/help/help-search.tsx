"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"

type Item = { title: string; summary: string; category: string; href: string }

// Client-side search over all guides — no backend needed for a small content set.
export function HelpSearch({ items }: { items: Item[] }) {
  const [q, setQ] = useState("")
  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return items.filter((it) => `${it.title} ${it.summary} ${it.category}`.toLowerCase().includes(query)).slice(0, 8)
  }, [q, items])

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the guides…"
        className="h-12 w-full rounded-xl border bg-card ps-11 pe-4 text-base outline-none focus:border-primary/50"
      />
      {results.length > 0 && (
        <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
          {results.map((r) => (
            <Link key={r.href} href={r.href} className="block border-b px-4 py-3 last:border-b-0 hover:bg-accent/50">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="truncate text-xs text-muted-foreground">{r.category} · {r.summary}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
