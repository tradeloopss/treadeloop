import type { Metadata } from "next"
import Link from "next/link"
import { requireAdmin } from "@/lib/admin/guard"
import { activity, capabilities, type ActivityCategory } from "@/lib/admin/command-center"
import { ACTIVITY_LABELS, StatusPill } from "@/components/admin/command/cards"
import { AdminPageHeader, fmtDateTime } from "@/components/admin/ui"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Activity — TradeLoop Admin" }

const CATEGORIES = Object.keys(ACTIVITY_LABELS) as ActivityCategory[]

// The Overview's Recent activity, in full: the latest 100 events of each kind
// the admin's role can see.
export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const admin = await requireAdmin({ user: ["list"] })
  const can = capabilities(admin.role)
  const allowed = CATEGORIES.filter((c) => (c === "users" ? can.users || can.affiliates : c === "payments" ? can.billing || can.affiliates : c === "support" ? can.support : c === "trading" ? can.brokers : can.security))
  const { type } = await searchParams
  const only = allowed.find((c) => c === type)
  let items: Awaited<ReturnType<typeof activity>> | null = null
  try {
    items = await activity(can, 100, only)
  } catch (e) {
    console.error("[admin] activity page failed:", e instanceof Error ? e.message : e)
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <AdminPageHeader title="Activity" description="The latest events across TradeLoop, newest first." />
      <div className="p-4 sm:p-6">
        <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="navigation" aria-label="Filter activity">
          {[undefined, ...allowed].map((c) => (
            <Link
              key={c ?? "all"}
              href={c ? `/admin/activity?type=${c}` : "/admin/activity"}
              aria-current={only === c ? "page" : undefined}
              className={cn("inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium", only === c ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {c ? ACTIVITY_LABELS[c] : "All"}
            </Link>
          ))}
        </div>
        {!items ? (
          <p className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">Unable to load activity. Reload the page to try again.</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 sm:flex-nowrap sm:px-5">
                  <time dateTime={item.at} className="w-full shrink-0 text-xs text-muted-foreground tabular-nums sm:w-32">
                    {fmtDateTime(item.at)}
                  </time>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ACTIVITY_LABELS[item.category]}</span>
                  {item.status && <StatusPill status={item.status} />}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
