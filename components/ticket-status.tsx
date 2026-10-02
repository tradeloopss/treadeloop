import { cn } from "@/lib/utils"
import { getT } from "@/lib/i18n/server"

// "open" means the ball is with staff, "waiting" means it's with the user —
// worded from whichever side is looking.
export async function TicketStatus({ status, forStaff }: { status: string; forStaff: boolean }) {
  const t = await getT()
  const label =
    status === "closed" ? t("Closed") : status === "waiting" ? (forStaff ? t("Waiting on user") : t("Reply from support")) : forStaff ? t("Needs reply") : t("Open")
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        status === "closed"
          ? "bg-muted text-muted-foreground"
          : (status === "open") === forStaff
            ? "bg-primary/12 text-primary"
            : "bg-muted text-foreground"
      )}
    >
      {label}
    </span>
  )
}

// What staff should notice about a request before its status: it jumps the
// queue (priority support is a tier perk of the affiliate program), or it is a
// feature request rather than a question. Renders nothing for an ordinary one.
export function TicketFlags({ priority, kind, className }: { priority: boolean; kind: string; className?: string }) {
  if (!priority && kind !== "feature_request") return null
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {priority && <span className="shrink-0 rounded-full bg-[var(--chart-4)]/15 px-2 py-0.5 text-xs font-medium text-[var(--chart-4)]">Priority</span>}
      {kind === "feature_request" && <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">Feature request</span>}
    </span>
  )
}
