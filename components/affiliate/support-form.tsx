"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { contactAffiliateSupport } from "@/app/actions/affiliate"
import { selectClass } from "./ui"

const TOPICS = ["A commission or balance", "A payout", "Tracking or a missing referral", "My account", "Something else"]

// Sends the question into the app's existing support queue; the conversation
// continues on the regular support page.
export function AffiliateSupportForm() {
  const [topic, setTopic] = useState(TOPICS[0])
  const [message, setMessage] = useState("")
  const [ticketId, setTicketId] = useState<number | null>(null)
  const [pending, start] = useTransition()

  if (ticketId != null) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center" role="status">
        <CheckCircle2 className="size-8 text-[var(--gain)]" aria-hidden />
        <p className="mt-3 text-sm font-medium">Message sent</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">We usually reply within one business day. You&apos;ll get the answer by email and in your support requests.</p>
        <div className="mt-4 flex gap-2">
          <Link href={`/support/${ticketId}`} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            View request
          </Link>
          <Button variant="outline" onClick={() => (setTicketId(null), setMessage(""))}>
            Send another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await contactAffiliateSupport({ subject: topic, message })
          if (res.ok) setTicketId(res.ticketId)
          else toast.error(res.error)
        })
      }}
    >
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        What is it about?
        <select value={topic} onChange={(e) => setTopic(e.target.value)} className={selectClass}>
          {TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Your message
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} placeholder="Include a referral reference (TL-…) or payout date if it's about a specific one." required />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{message.length}/5000</span>
        <Button type="submit" disabled={pending || message.trim().length < 10}>
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  )
}
