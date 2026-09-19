import { cn } from "@/lib/utils"

// "open" means the ball is with staff, "waiting" means it's with the user —
// worded from whichever side is looking.
export function TicketStatus({ status, forStaff }: { status: string; forStaff: boolean }) {
  const label =
    status === "closed" ? "Closed" : status === "waiting" ? (forStaff ? "Waiting on user" : "Reply from support") : forStaff ? "Needs reply" : "Open"
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
