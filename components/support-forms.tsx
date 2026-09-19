"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createTicket, replyToMyTicket } from "@/app/actions/support"

export function NewTicketForm() {
  const [pending, startTransition] = useTransition()
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          // Redirects to the new request on success.
          const result = await createTicket(subject, body)
          if (result?.error) toast.error(result.error)
        })
      }}
    >
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What do you need help with?" maxLength={140} required />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Tell us what happened — which broker or file, what you expected, what you saw." rows={5} maxLength={5000} required />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send to support"}
      </Button>
    </form>
  )
}

// Used by the user's own thread; the admin side has its own reply form.
export function TicketReplyForm({ ticketId, closed }: { ticketId: number; closed: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState("")
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const result = await replyToMyTicket(ticketId, body)
          if ("error" in result) toast.error(result.error)
          else {
            setBody("")
            router.refresh()
          }
        })
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={closed ? "Reply to reopen this request…" : "Write a reply…"} rows={4} maxLength={5000} required />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : closed ? "Reopen and reply" : "Reply"}
      </Button>
    </form>
  )
}
