"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { markAnnouncementRead } from "@/app/actions/affiliate"
import { Empty } from "./ui"

export type AnnouncementView = { id: number; title: string; category: string; summary: string | null; content: string; publishedAt: string; read: boolean }

export function AnnouncementsList({ items }: { items: AnnouncementView[] }) {
  const router = useRouter()
  const [open, setOpen] = useState<number | null>(null)
  const [seen, setSeen] = useState<Set<number>>(new Set())
  const [, start] = useTransition()

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty icon={Megaphone} title="No announcements yet">
          Program news, promotions and product updates will show up here.
        </Empty>
      </div>
    )
  }

  function toggle(item: AnnouncementView) {
    const opening = open !== item.id
    setOpen(opening ? item.id : null)
    // Opening one is what marks it read.
    if (opening && !item.read && !seen.has(item.id)) {
      setSeen((s) => new Set(s).add(item.id))
      start(async () => {
        await markAnnouncementRead(item.id)
        router.refresh()
      })
    }
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const unread = !item.read && !seen.has(item.id)
        const expanded = open === item.id
        return (
          <li key={item.id} className="rounded-xl border bg-card">
            <button type="button" onClick={() => toggle(item)} aria-expanded={expanded} aria-controls={`announcement-${item.id}`} className="flex w-full items-start gap-3 px-5 py-4 text-start">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{item.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">{item.category}</span>
                  {unread && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">New</span>}
                </span>
                {item.summary && <span className="mt-1 block text-sm text-muted-foreground">{item.summary}</span>}
                <span className="mt-1 block text-xs text-muted-foreground">{new Date(item.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
              </span>
              <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
            {expanded && (
              <div id={`announcement-${item.id}`} className="whitespace-pre-wrap border-t px-5 py-4 text-sm leading-relaxed">
                {item.content}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
