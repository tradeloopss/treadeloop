"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createTicket, replyToMyTicket } from "@/app/actions/support"
import { useT } from "@/components/locale-provider"

export function NewTicketForm() {
  const t = useT()
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
          if (result?.error) toast.error(t(result.error))
        })
      }}
    >
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("What do you need help with?")} maxLength={140} required />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("Tell us what happened — which broker or file, what you expected, what you saw.")} rows={5} maxLength={5000} required />
      <Button type="submit" disabled={pending}>
        {pending ? t("Sending…") : t("Send to support")}
      </Button>
    </form>
  )
}

// Used by the user's own thread; the admin side has its own reply form.
export function TicketReplyForm({ ticketId, closed }: { ticketId: number; closed: boolean }) {
  const router = useRouter()
  const t = useT()
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState("")
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const result = await replyToMyTicket(ticketId, body)
          if ("error" in result) toast.error(t(result.error))
          else {
            setBody("")
            router.refresh()
          }
        })
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={closed ? t("Reply to reopen this request…") : t("Write a reply…")} rows={4} maxLength={5000} required />
      <Button type="submit" disabled={pending}>
        {pending ? t("Sending…") : closed ? t("Reopen and reply") : t("Reply")}
      </Button>
    </form>
  )
}
