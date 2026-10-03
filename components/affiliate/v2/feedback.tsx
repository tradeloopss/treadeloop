"use client"

import { useState, useTransition } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { MessageSquareHeart } from "lucide-react"
import { sendDashboardFeedback } from "@/app/actions/affiliate-v2"
import { FEEDBACK_MAX, FEEDBACK_RATINGS, type FeedbackRating } from "@/lib/affiliates/v2/config"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineError, btnClass, ghostBtnClass } from "./ui"
import { cn } from "@/lib/utils"

// "How is the new Affiliate Dashboard?" — a rating and an optional note,
// stored with the affiliate's account for the team (admin → Affiliates → Dashboard).
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname()
  const [rating, setRating] = useState<FeedbackRating | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const reset = () => {
    setRating(null)
    setMessage("")
    setError(null)
  }
  const submit = () => {
    if (!rating) return setError("Choose how the new dashboard feels to you.")
    setError(null)
    start(async () => {
      const res = await sendDashboardFeedback({ rating, message, page: pathname }).catch(() => ({ ok: false as const, error: "We couldn't send that. Check your connection and try again." }))
      if (res.ok) {
        toast.success("Thanks for the feedback!")
        reset()
        onOpenChange(false)
      } else setError(res.error)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <span className="v2-icon mb-1 flex size-10 items-center justify-center rounded-xl" aria-hidden>
              <MessageSquareHeart className="size-5" />
            </span>
            <DialogTitle className="text-base font-semibold">How is the new Affiliate Dashboard?</DialogTitle>
            <DialogDescription>Your answer goes straight to the TradeLoop team building it.</DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Your rating" className="grid grid-cols-2 gap-2">
            {FEEDBACK_RATINGS.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={rating === r.key}
                onClick={() => setRating(r.key)}
                className={cn("flex min-h-12 items-center gap-2.5 rounded-xl border px-3 text-start text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", rating === r.key ? "border-primary bg-primary/10 text-foreground" : "hover:border-primary/40 hover:bg-muted/50")}
              >
                <span className="text-xl leading-none" aria-hidden>
                  {r.emoji}
                </span>
                {r.label}
              </button>
            ))}
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Tell us what we should improve
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX))}
              rows={4}
              placeholder="What works, what's missing, what got in your way…"
              className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm font-normal outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <span className="text-end text-[11px] font-normal text-muted-foreground tabular-nums">
              {message.length}/{FEEDBACK_MAX}
            </span>
          </label>
          {error && <InlineError>{error}</InlineError>}
          <DialogFooter className="max-sm:rounded-b-none">
            <button type="button" className={ghostBtnClass} onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={btnClass} disabled={pending}>
              {pending ? "Sending…" : "Send Feedback"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(ghostBtnClass, className)}>
        <MessageSquareHeart className="size-4 text-primary" aria-hidden /> Send feedback
      </button>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
