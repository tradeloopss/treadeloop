"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { sendActionCode, type CodeRequest, type SendCodeResult } from "@/app/actions/affiliate"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cleanCode, isCode, type CodeChannel } from "@/lib/affiliates/action-code-rules"
import { cn } from "@/lib/utils"

// The verification step in front of the two things that move an affiliate's
// money: confirming a payout and adding a payout method. This is only the
// asking — the code is checked on the server, by the action that does the
// thing (app/actions/affiliate.ts), whatever happens here.

// idle → sending → ready (enter the code) | off (verification is switched off) | failed
type Phase = "idle" | "sending" | "ready" | "off" | "failed"

export type CodeFlow = ReturnType<typeof useActionCode>

export function useActionCode() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [info, setInfo] = useState<{ channel: CodeChannel; sentTo: string | null } | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [code, setRaw] = useState("")
  // only the latest request's answer counts
  const seq = useRef(0)

  // Asks the server to start the verification for exactly this thing.
  const request = useCallback(async (input: CodeRequest): Promise<Phase> => {
    const mine = ++seq.current
    const again = input.resend === true
    if (!again) {
      setPhase("sending")
      setRaw("")
    }
    setError(null)
    let res: SendCodeResult
    try {
      res = await sendActionCode(input)
    } catch {
      res = { ok: false, error: "We couldn't reach TradeLoop. Check your connection and try again." }
    }
    if (mine !== seq.current) return "sending"
    if (!res.ok) {
      setError(res.error)
      // a refused "send another" leaves the code already sent in play
      if (again) return "ready"
      setPhase("failed")
      return "failed"
    }
    if (!res.required) {
      setPhase("off")
      return "off"
    }
    setInfo({ channel: res.channel, sentTo: res.sentTo })
    setResendAt(Date.now() + res.resendInSeconds * 1000)
    if (again) setRaw("")
    setPhase("ready")
    return "ready"
  }, [])

  const reset = useCallback(() => {
    seq.current++
    setPhase("idle")
    setInfo(null)
    setError(null)
    setRaw("")
  }, [])

  return {
    phase,
    info,
    resendAt,
    error,
    code,
    setCode: (text: string) => (setRaw(cleanCode(text)), setError(null)),
    // what the server said about a code it was given (wrong, expired…)
    fail: (message: string) => (setError(message), setRaw("")),
    request,
    reset,
    // The thing may be confirmed: verification is off, or six digits are in.
    satisfied: phase === "off" || (phase === "ready" && isCode(code)),
    // what to send along with the action
    value: phase === "ready" ? code : undefined,
  }
}

// The code box, with where the code is and how to get another.
// `focus`: "desktop" (the default) puts the cursor in the box only where there
// is a mouse — on a phone that would raise the keyboard over the details the
// person is meant to check first. "always" is for a window that holds nothing else.
export function CodeField({ flow, onResend, onEnter, disabled = false, focus = "desktop", className }: { flow: CodeFlow; onResend: () => void; onEnter?: () => void; disabled?: boolean; focus?: "always" | "desktop" | "never"; className?: string }) {
  const id = useId()
  const [autoFocus] = useState(() => focus === "always" || (focus === "desktop" && typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (flow.phase !== "ready" || flow.resendAt <= Date.now()) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [flow.phase, flow.resendAt])

  if (flow.phase === "idle" || flow.phase === "off") return null
  if (flow.phase === "sending") {
    return (
      <p role="status" className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Getting your verification code ready…
      </p>
    )
  }
  if (flow.phase === "failed") {
    return (
      <div role="alert" className={cn("rounded-xl border border-loss/30 bg-loss/[0.06] px-3.5 py-3 text-[13px]", className)}>
        <p className="font-semibold text-loss">We couldn&apos;t start the verification</p>
        <p className="mt-0.5 text-foreground/85">{flow.error}</p>
        <button type="button" onClick={onResend} disabled={disabled} className="mt-2 text-sm font-semibold text-primary hover:underline">
          Try again
        </button>
      </div>
    )
  }

  const app = flow.info?.channel === "app"
  const wait = Math.max(0, Math.ceil((flow.resendAt - now) / 1000))
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-primary" aria-hidden /> Verification code
      </label>
      <p id={`${id}-help`} className="text-[13px] leading-relaxed text-muted-foreground">
        {app ? (
          "Enter the 6-digit code from your authenticator app."
        ) : (
          <>
            We emailed a 6-digit code to <span className="font-medium text-foreground">{flow.info?.sentTo}</span>. It expires in 10 minutes.
          </>
        )}
      </p>
      <input
        id={id}
        value={flow.code}
        onChange={(e) => flow.setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="000000"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={!!flow.error}
        aria-describedby={`${id}-help`}
        className={cn(
          "h-14 w-full rounded-xl border bg-background ps-[0.4em] text-center font-mono text-2xl font-semibold tracking-[0.4em] tabular-nums outline-none transition-shadow placeholder:font-normal placeholder:text-muted-foreground/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60",
          flow.error ? "border-loss" : "border-input"
        )}
      />
      {flow.error && (
        <p role="alert" className="text-xs font-medium text-loss">
          {flow.error}
        </p>
      )}
      {!app && (
        <p className="text-xs text-muted-foreground">
          Didn&apos;t get it? Check your spam folder, or{" "}
          {wait > 0 ? (
            <span className="tabular-nums">send a new code in {wait}s</span>
          ) : (
            <button type="button" onClick={onResend} disabled={disabled} className="font-semibold text-primary hover:underline disabled:opacity-60">
              send a new code
            </button>
          )}
          .
        </p>
      )}
    </div>
  )
}

type Outcome = { ok: true } | { ok: false; error: string }

// A small window that asks for the code and then does the thing — for the
// places that have no confirmation screen of their own (adding a payout
// method, continuing to Stripe). With verification switched off it does the
// thing straight away.
export function CodePrompt<T extends Outcome>({ open, onOpenChange, request, title = "Verify it's you", description, confirmLabel = "Confirm", pendingLabel = "Confirming…", action, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; request: CodeRequest; title?: string; description?: string; confirmLabel?: string; pendingLabel?: string; action: (code: string | undefined) => Promise<T>; onDone: (result: Extract<T, { ok: true }>) => void }) {
  const flow = useActionCode()
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // the latest props, for the effect that runs once per opening
  const live = useRef({ request, action, onDone, flow })
  useEffect(() => {
    live.current = { request, action, onDone, flow }
  })

  const go = useCallback(async (code: string | undefined) => {
    setPending(true)
    setProblem(null)
    let res: T
    try {
      res = await live.current.action(code)
    } catch {
      res = { ok: false, error: "We couldn't reach TradeLoop. Check your connection and try again." } as T
    }
    setPending(false)
    if (res.ok) live.current.onDone(res as Extract<T, { ok: true }>)
    else if (code == null) setProblem(res.error)
    else live.current.flow.fail(res.error)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProblem(null)
    live.current.flow.request(live.current.request).then((phase) => {
      // nothing to verify: do it now
      if (!cancelled && phase === "off") void go(undefined)
    })
    return () => {
      cancelled = true
      live.current.flow.reset()
    }
  }, [open, go])

  const close = (next: boolean) => {
    if (pending) return
    onOpenChange(next)
  }
  // With verification off the thing runs by itself; the button is only for trying again after a refusal.
  const canConfirm = !pending && (flow.phase === "off" ? !!problem : flow.satisfied)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="top-auto bottom-0 left-0 flex w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-t-3xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <form
          className="flex flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (canConfirm) void go(flow.value)
          }}
        >
          <header className="px-5 pt-5 pb-3 pe-12">
            <DialogTitle className="text-lg leading-tight font-semibold tracking-tight">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">{description ?? "For your security, confirm this with a verification code."}</DialogDescription>
          </header>
          <div className="flex flex-col gap-3 px-5 pb-5">
            {flow.phase === "off" ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />} {pending ? pendingLabel : ""}
              </p>
            ) : (
              <CodeField flow={flow} focus="always" disabled={pending} onResend={() => void flow.request({ ...request, resend: flow.phase === "ready" })} />
            )}
            {problem && (
              <p role="alert" className="rounded-xl border border-loss/30 bg-loss/[0.06] px-3.5 py-2.5 text-[13px] text-loss">
                {problem}
              </p>
            )}
          </div>
          <footer className="flex gap-2.5 border-t bg-muted/30 px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl">
            <button type="button" onClick={() => close(false)} disabled={pending} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border bg-background text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={!canConfirm} aria-busy={pending} className="inline-flex h-12 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55">
              {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />} {pending ? pendingLabel : flow.phase === "off" && problem ? "Try Again" : confirmLabel}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}
