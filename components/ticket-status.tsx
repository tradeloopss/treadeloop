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
