"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCheck, Handshake, LifeBuoy, PlugZap, ShieldAlert, Wallet, type LucideIcon } from "lucide-react"
import { markAdminNotificationRead, markAllAdminNotificationsRead, type BellItem } from "@/app/actions/admin-shell"
import type { NoticeCategory } from "@/lib/admin/command-center-rules"
import { TONE_DOT, TONE_ICON } from "@/components/admin/command/tones"
import { cn } from "@/lib/utils"

const ICONS: Record<NoticeCategory, LucideIcon> = { payouts: Wallet, affiliates: Handshake, support: LifeBuoy, brokers: PlugZap, security: ShieldAlert }

export function NotificationRow({ item, when }: { item: BellItem; when: string }) {
  const [unread, setUnread] = useState(item.unread)
  const Icon = ICONS[item.category]
  return (
    <Link
      href={item.href}
      onClick={() => {
        if (!unread) return
        setUnread(false)
        markAdminNotificationRead(item.key).catch(() => {})
      }}
      className={cn("flex gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-5", unread && "bg-primary/[0.03] dark:bg-primary/[0.06]")}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE_ICON[item.tone])} aria-hidden>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", unread ? "font-semibold" : "font-medium")}>{item.title}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{item.detail}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground/80">{when}</span>
      </span>
      {unread && (
        <span className="mt-2 shrink-0">
          <span className={cn("block size-2 rounded-full", TONE_DOT[item.tone])} aria-hidden />
          <span className="sr-only">Unread</span>
        </span>
      )}
    </Link>
  )
}

export function MarkAllRead() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllAdminNotificationsRead().catch(() => {})
          router.refresh()
        })
      }
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
    >
      <CheckCheck className="size-4" aria-hidden /> Mark all as read
    </button>
  )
}
