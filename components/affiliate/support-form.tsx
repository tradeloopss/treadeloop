"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { CheckCircle2, Zap } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { contactAffiliateSupport } from "@/app/actions/affiliate"
import { selectClass } from "./ui"
import { appHref } from "@/lib/urls"

const TOPICS = ["A commission or balance", "A payout", "Tracking or a missing referral", "My account", "Something else"]

// Sends the question into the app's existing support queue; the conversation
// continues on the regular support page. `priority` — the affiliate's tier
// includes priority support: their requests are answered first, and they can
// send a feature request from here too. (The server decides both from the tier;
// this only shows what will happen.)
export function AffiliateSupportForm({ priority = false }: { priority?: boolean }) {
  const [kind, setKind] = useState<"support" | "feature_request">("support")
  const [topic, setTopic] = useState(TOPICS[0])
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [ticketId, setTicketId] = useState<number | null>(null)
  const [pending, start] = useTransition()

  if (ticketId != null) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center" role="status">
        <CheckCircle2 className="size-8 text-[var(--gain)]" aria-hidden />
        <p className="mt-3 text-sm font-medium">Message sent</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{priority ? "Your request is at the front of the queue." : "We usually reply within one business day."} You&apos;ll get the answer by email and in your support requests.</p>
        <div className="mt-4 flex gap-2">
          <Link href={appHref(`/support/${ticketId}`)} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            View request
          </Link>
          <Button variant="outline" onClick={() => (setTicketId(null), setMessage(""), setTitle(""))}>
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
          const res = await contactAffiliateSupport(kind === "feature_request" ? { subject: title, message, kind } : { subject: topic, message })
          if (res.ok) setTicketId(res.ticketId)
          else toast.error(res.error)
        })
      }}
    >
      {priority && (
        <>
          <p className="flex items-center gap-2 rounded-lg bg-[var(--chart-4)]/10 px-3 py-2 text-xs font-medium text-[var(--chart-4)]">
            <Zap className="size-3.5 shrink-0" aria-hidden /> Priority support — your requests are answered first.
          </p>
          <div role="radiogroup" aria-label="What are you sending?" className="grid grid-cols-2 gap-2">
            {(
              [
                ["support", "A question"],
                ["feature_request", "A feature request"],
              ] as const
            ).map(([value, text]) => (
              <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)} className={`h-9 rounded-lg border px-3 text-sm transition-colors ${kind === value ? "border-primary bg-primary/8 font-medium" : "border-input hover:bg-muted"}`}>
                {text}
              </button>
            ))}
          </div>
        </>
      )}
      {kind === "feature_request" ? (
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          The feature, in a few words
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="e.g. Export trades to Excel" required />
        </label>
      ) : (
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          What is it about?
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className={selectClass}>
            {TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {kind === "feature_request" ? "What should it do, and what would you use it for?" : "Your message"}
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} placeholder={kind === "feature_request" ? "Describe the problem it solves for you or your audience." : "Include a referral reference (TL-…) or payout date if it's about a specific one."} required />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{message.length}/5000</span>
        <Button type="submit" disabled={pending || message.trim().length < 10 || (kind === "feature_request" && title.trim().length < 3)}>
          {pending ? "Sending…" : kind === "feature_request" ? "Send request" : "Send message"}
        </Button>
      </div>
    </form>
  )
}
