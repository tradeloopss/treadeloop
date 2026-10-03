import type React from "react"
import Link from "next/link"
import { ArrowLeft, Settings } from "lucide-react"
import { AdminNav, type NavItem } from "@/components/admin/admin-nav"
import { BrandMark } from "@/components/brand-mark"
import { ReturnToNewButton } from "@/components/admin/shell/dashboard-switch"

// The previous admin dashboard's frame, kept as it was for admins who choose
// it in Admin Settings. Two additions only: the way back to the new dashboard,
// and a link to Admin Settings — on a phone too.
export function LegacyShell({ items, roleLabel, email, children }: { items: NavItem[]; roleLabel: string; email: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background md:flex-row">
      <aside className="shrink-0 border-b bg-sidebar md:sticky md:top-0 md:flex md:h-svh md:w-60 md:flex-col md:border-e md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-5 pt-5 md:pb-2">
          <div className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="font-semibold tracking-tight">Admin</span>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{roleLabel}</span>
        </div>
        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
          <AdminNav items={items} />
        </div>
        <div className="hidden px-3 pb-4 md:block">
          <ReturnToNewButton />
          <Link href="/admin/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <Settings className="size-4" /> Admin settings
          </Link>
          <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to app
          </Link>
          <p className="truncate px-3 pt-1 text-xs text-muted-foreground" title={email}>
            {email}
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-1.5 md:hidden">
          <span className="text-xs text-muted-foreground">Old dashboard</span>
          <span className="flex items-center gap-1">
            <Link href="/admin/settings" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
              Settings
            </Link>
            <ReturnToNewButton compact />
          </span>
        </div>
        {children}
      </main>
    </div>
  )
}
