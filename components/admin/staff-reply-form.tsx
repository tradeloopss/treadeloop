"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { setTicketStatus, staffReply } from "@/app/actions/admin"

export function StaffReplyForm({ ticketId, status }: { ticketId: number; status: string }) {
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState("")

  function reply(next: "waiting" | "closed") {
    startTransition(async () => {
      const result = await staffReply(ticketId, body, next)
      if (result.ok) {
        toast.success(result.message ?? "Reply sent.")
        setBody("")
      } else toast.error(result.error)
    })
  }

  return (
    <div className="space-y-3">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} placeholder="Write a reply — the user gets it by email and in the app." />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !body.trim()} onClick={() => reply("waiting")}>
          Send reply
        </Button>
        <Button variant="outline" disabled={pending || !body.trim()} onClick={() => reply("closed")}>
          Send and close
        </Button>
        <span className="flex-1" />
        {status !== "closed" ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setTicketStatus(ticketId, "closed")
                if (!result.ok) toast.error(result.error)
              })
            }
          >
            Close without replying
          </Button>
        ) : (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setTicketStatus(ticketId, "open")
                if (!result.ok) toast.error(result.error)
              })
            }
          >
            Reopen
          </Button>
        )}
      </div>
    </div>
  )
}
