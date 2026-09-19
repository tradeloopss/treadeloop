import { cn } from "@/lib/utils"
import { getLocale } from "@/lib/i18n/server"
import { intlLocale } from "@/lib/i18n"

export type ThreadMessage = { id: number; body: string; fromStaff: boolean; createdAt: Date; authorLabel: string }

// A support conversation, oldest first. `viewer` decides which side is "you".
export async function TicketThread({ messages, viewer }: { messages: ThreadMessage[]; viewer: "user" | "staff" }) {
  const dateLocale = intlLocale(await getLocale())
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const mine = viewer === "staff" ? m.fromStaff : !m.fromStaff
        return (
          <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-xl px-4 py-3", mine ? "bg-primary/10" : "border bg-card")}>
              <p className="mb-1 text-xs text-muted-foreground">
                {m.authorLabel} · {new Date(m.createdAt).toLocaleString(dateLocale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
