"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { Activity, BadgeDollarSign, Bug, CircleCheck, CreditCard, FlaskConical, Gauge, Headset, Info, Lightbulb, Loader2, Lock, type LucideIcon, Mail, MessageSquareText, RefreshCw, Send, ShieldCheck, TriangleAlert, User, UserRound, Users, Wallet, Wrench, Zap } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { sendSupportRequest, supportPrefill } from "@/app/actions/support"
import { MESSAGE_MAX, NAME_MAX, SUPPORT_CATEGORIES, categoryLabel, emailValid, messageProblem, type SupportCategory } from "@/lib/support/request"
import { appHref } from "@/lib/urls"

const CATEGORY_ICONS: Record<SupportCategory, LucideIcon> = {
  account: UserRound,
  billing: CreditCard,
  affiliate: Users,
  payout: Wallet,
  trading_account: BadgeDollarSign,
  trade_manager: Activity,
  prop_firm: Gauge,
  backtesting: FlaskConical,
  technical: Wrench,
  bug: Bug,
  feature: Lightbulb,
  sync: RefreshCw,
  security: ShieldCheck,
  other: MessageSquareText,
}

// What we can actually promise. In-app chat is the second channel: it is there
// for anyone signed in to TradeLoop.
const ASSURANCES: [LucideIcon, string, string][] = [
  [Zap, "Quick Response", "Usually within one business day"],
  [ShieldCheck, "Expert Support", "Our team knows TradeLoop inside out"],
  [Lock, "Secure & Private", "Only our support team reads your message"],
  [Mail, "Multiple Channels", "Email, and chat inside the app"],
]

const label = "text-sm font-medium"
const fieldError = "mt-1.5 text-xs text-[var(--loss)]"

type Sent = { ref: string; email: string; ticketId: number; signedIn: boolean }

// `asked` changes each time the window is opened from somewhere, so the subject
// that opening asked for is picked up; what was typed stays until it is sent.
export function ContactSupportDialog({ open, onOpenChange, asked, defaultCategory }: { open: boolean; onOpenChange: (open: boolean) => void; asked: number; defaultCategory?: SupportCategory }) {
  const ids = { subject: useId(), message: useId(), messageHelp: useId(), email: useId(), name: useId() }
  const [category, setCategory] = useState<SupportCategory | "">(defaultCategory ?? "")
  const [message, setMessage] = useState("")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  // filled by nothing a person does (it is off-screen): see lib/support looksAutomated
  const [company, setCompany] = useState("")
  const [account, setAccount] = useState<{ email: string } | null>(null)
  const [touched, setTouched] = useState<{ category?: boolean; message?: boolean; email?: boolean }>({})
  const [failure, setFailure] = useState<{ text: string; limited: boolean } | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)
  const [pending, start] = useTransition()

  // Each opening: the subject it asked for, and who is signed in (if anyone).
  useEffect(() => {
    if (!open) return
    if (defaultCategory) setCategory(defaultCategory)
    let live = true
    supportPrefill()
      .then((me) => {
        if (!live) return
        setAccount(me ? { email: me.email } : null)
        if (me) {
          setEmail(me.email)
          setName((n) => n || me.name)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, open])

  const length = message.trim().length
  const over = length > MESSAGE_MAX
  const problems = {
    category: category ? null : "Please select a subject.",
    message: messageProblem(message),
    email: emailValid(email.trim().toLowerCase()) ? null : "Please enter a valid email address.",
  }
  const invalid = !!(problems.category || problems.message || problems.email)
  const show = (k: keyof typeof problems) => (touched[k] || (k === "message" && over) ? problems[k] : null)

  const reset = () => {
    setCategory("")
    setMessage("")
    setTouched({})
    setFailure(null)
    setSent(null)
  }
  const close = (next: boolean) => {
    if (pending) return
    onOpenChange(next)
    // a sent request is done with: the next opening starts clean
    if (!next && sent) setTimeout(reset, 200)
  }

  const submit = () => {
    setTouched({ category: true, message: true, email: true })
    if (invalid || pending) return
    setFailure(null)
    start(async () => {
      try {
        const res = await sendSupportRequest({ category, message, email, name, company, page: `${window.location.hostname}${window.location.pathname}` })
        if (res.ok) {
          setSent({ ref: res.ref, email: res.email, ticketId: res.ticketId, signedIn: res.signedIn })
          toast.success("Support request sent", { description: `Ticket #${res.ref}` })
        } else if (res.field) {
          // the server found something the form didn't: show it on the field
          setTouched({ category: true, message: true, email: true })
          setFailure({ text: res.error, limited: false })
        } else setFailure({ text: res.error, limited: !!res.limited })
      } catch {
        setFailure({ text: "We couldn't send your message right now. Please try again.", limited: false })
      }
    })
  }

  const SubjectIcon = category ? CATEGORY_ICONS[category] : MessageSquareText

  return (
    <Dialog open={open} onOpenChange={close}>
      {/* A sheet from the bottom on a phone, a centred window from sm up. */}
      <DialogContent className="top-auto bottom-0 left-0 flex max-h-[94svh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[min(54rem,94svh)] sm:max-w-[46rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        {sent ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-12 pb-8 text-center" role="status">
              <span className="flex size-16 items-center justify-center rounded-full bg-[var(--gain)]/12 text-[var(--gain)] duration-300 animate-in fade-in zoom-in-75 motion-reduce:animate-none">
                <CircleCheck className="size-8" aria-hidden />
              </span>
              <DialogTitle className="mt-5 text-xl font-semibold tracking-tight">Message sent</DialogTitle>
              <DialogDescription className="mt-1.5 text-sm text-muted-foreground">We&apos;ve received your request.</DialogDescription>
              <p className="mt-5 rounded-xl border bg-muted/40 px-5 py-3 text-sm">
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">Ticket</span>
                <span className="font-mono text-base font-semibold">#{sent.ref}</span>
              </p>
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                We&apos;ll get back to you as soon as possible. A confirmation is on its way to <span className="font-medium text-foreground">{sent.email}</span>.
              </p>
            </div>
            <footer className="flex shrink-0 flex-col-reverse gap-2.5 border-t bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
              {sent.signedIn && (
                <a href={appHref(`/support/${sent.ticketId}`)} className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">
                  View request
                </a>
              )}
              <DialogClose render={<Button type="button" className="h-11 px-8 text-sm" />}>Done</DialogClose>
            </footer>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <header className="flex shrink-0 items-start gap-4 px-5 pt-6 pb-5 pe-14 sm:px-7">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:size-14 dark:bg-primary/15 dark:ring-1 dark:ring-primary/25">
                <Headset className="size-6 sm:size-7" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <DialogTitle className="text-xl font-semibold leading-tight tracking-tight">Contact Support</DialogTitle>
                <DialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">We&apos;re here to help. Send us a message and we&apos;ll get back to you as soon as possible.</DialogDescription>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-6 sm:px-7">
              <ul className="grid grid-cols-2 rounded-2xl border bg-muted/40 sm:grid-cols-4">
                {ASSURANCES.map(([Icon, title, body], i) => (
                  <li key={title} className={cn("px-4 py-4", i % 2 === 1 && "border-s", i >= 2 && "border-t sm:border-t-0", i === 2 && "sm:border-s")}>
                    <Icon className="size-5 text-primary" aria-hidden />
                    <p className="mt-2.5 text-[13px] font-semibold leading-tight">{title}</p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{body}</p>
                  </li>
                ))}
              </ul>

              <div>
                <label htmlFor={ids.subject} className={label}>
                  Subject
                </label>
                <Select value={category || null} onValueChange={(v) => (v && setCategory(v as SupportCategory), setTouched((t) => ({ ...t, category: true })))}>
                  <SelectTrigger id={ids.subject} aria-invalid={!!show("category")} className="mt-2 h-11 w-full gap-3 rounded-xl ps-3.5 pe-3 text-sm data-[size=default]:h-11">
                    <SubjectIcon className="size-[18px] text-muted-foreground" aria-hidden />
                    <SelectValue placeholder="Select a subject">{(v: string | null) => (v ? categoryLabel(v) : "Select a subject")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} className="max-h-72 p-1">
                    {SUPPORT_CATEGORIES.map((c) => {
                      const Icon = CATEGORY_ICONS[c.id]
                      return (
                        <SelectItem key={c.id} value={c.id} className="rounded-lg py-2 ps-2.5">
                          <Icon className="size-4 text-muted-foreground" aria-hidden />
                          {c.label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                {show("category") && (
                  <p role="alert" className={fieldError}>
                    {show("category")}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={ids.message} className={label}>
                  Your Message
                </label>
                <div className="relative mt-2">
                  <Textarea
                    id={ids.message}
                    value={message}
                    onChange={(e) => (setMessage(e.target.value), setFailure(null))}
                    onBlur={() => setTouched((t) => ({ ...t, message: true }))}
                    rows={6}
                    aria-invalid={!!show("message")}
                    aria-describedby={ids.messageHelp}
                    placeholder={"Describe your issue in detail…\nInclude anything relevant, such as your account ID, error messages, or the steps to reproduce the issue."}
                    className="min-h-36 resize-y rounded-xl px-3.5 pt-3 pb-8 text-sm leading-relaxed"
                  />
                  <span aria-live="polite" className={cn("pointer-events-none absolute end-3.5 bottom-2.5 text-xs tabular-nums", over ? "font-medium text-[var(--loss)]" : length > MESSAGE_MAX * 0.9 ? "text-[var(--chart-4)]" : "text-muted-foreground")}>
                    {length.toLocaleString("en-US")} / {MESSAGE_MAX.toLocaleString("en-US")}
                  </span>
                </div>
                {show("message") && (
                  <p role="alert" className={fieldError}>
                    {show("message")}
                  </p>
                )}
                <p id={ids.messageHelp} className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                  Never include passwords, API keys, private keys, or wallet recovery phrases in your message.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor={ids.email} className={label}>
                    Your Email Address
                  </label>
                  <div className="relative mt-2">
                    <Mail className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      id={ids.email}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => (setEmail(e.target.value), setFailure(null))}
                      onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                      // Signed in: the request belongs to the account, and is answered to its email.
                      readOnly={!!account}
                      aria-invalid={!!show("email")}
                      placeholder="you@example.com"
                      className={cn("h-11 rounded-xl ps-10 text-sm", account && "bg-muted/50 text-muted-foreground")}
                    />
                  </div>
                  {show("email") ? (
                    <p role="alert" className={fieldError}>
                      {show("email")}
                    </p>
                  ) : account ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">We&apos;ll reply to your account&apos;s email.</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor={ids.name} className={label}>
                    Name <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <div className="relative mt-2">
                    <User className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="name" placeholder="Your name" className="h-11 rounded-xl ps-10 text-sm" />
                  </div>
                </div>
              </div>

              {/* Not for people: off-screen, skipped by the keyboard and by screen readers. */}
              <div aria-hidden className="absolute -start-[9999px] size-px overflow-hidden">
                <label>
                  Company
                  <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
                </label>
              </div>

              {failure ? (
                <div role="alert" className={cn("flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm", failure.limited ? "border-[var(--chart-4)]/35 bg-[var(--chart-4)]/8" : "border-[var(--loss)]/30 bg-[var(--loss)]/8")}>
                  <TriangleAlert className={cn("mt-0.5 size-[18px] shrink-0", failure.limited ? "text-[var(--chart-4)]" : "text-[var(--loss)]")} aria-hidden />
                  <div>
                    <p className="font-semibold">{failure.limited ? "Please wait before sending another message" : "Something went wrong"}</p>
                    <p className="mt-0.5 leading-relaxed text-foreground/80">{failure.limited ? "For security and abuse prevention, support requests are temporarily limited." : failure.text}</p>
                  </div>
                </div>
              ) : (
                <p className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3.5 text-sm leading-relaxed text-foreground/85">
                  <Info className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden />
                  We reply by email, usually within one business day.
                </p>
              )}
            </div>

            <footer className="flex shrink-0 items-center gap-3 border-t bg-muted/40 px-5 py-4 sm:justify-end sm:px-7">
              {/* why the button can't be pressed yet, for anyone who hasn't touched a field */}
              {invalid && !pending && <p className="me-auto hidden text-xs text-muted-foreground sm:block">Add a subject, your message and your email to send.</p>}
              <Button type="button" variant="outline" className="h-11 flex-1 px-6 text-sm sm:flex-none" onClick={() => close(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 flex-[2] gap-2 px-6 text-sm sm:min-w-48 sm:flex-none" disabled={invalid || pending} aria-busy={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Sending…
                  </>
                ) : failure && !failure.limited ? (
                  <>
                    <Send className="size-4" aria-hidden /> Try Again
                  </>
                ) : (
                  <>
                    <Send className="size-4" aria-hidden /> Send Message
                  </>
                )}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
