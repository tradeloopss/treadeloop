"use client"

import { useState } from "react"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ForgotPasswordForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (sent) {
    return (
      <div className="space-y-4 text-center text-sm">
        <p>
          If <span className="font-medium">{email}</span> has a TradeLoop account, a reset link is on its way. Check your inbox (and spam).
        </p>
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        setLoading(true)
        const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })
        setLoading(false)
        // Same message whether or not the account exists, so the form can't
        // be used to find out who has an account.
        if (error && error.status !== 404) setError(error.status === 429 ? "Too many attempts — wait a minute and try again." : (error.message ?? "Couldn't send the email."))
        else setSent(true)
      }}
    >
      <Input type="email" className="h-12 rounded-xl" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required autoFocus />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={loading} className="mt-1 h-12 w-full rounded-xl text-base font-semibold">
        {loading ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/sign-in" className="mt-2 text-center text-sm text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (done) {
    return (
      <div className="space-y-4 text-center text-sm">
        <p>Your password is updated.</p>
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        if (password !== confirm) return setError("The two passwords don't match.")
        setLoading(true)
        const { error } = await authClient.resetPassword({ newPassword: password, token })
        setLoading(false)
        if (error) setError(error.message ?? "That link didn't work — request a new one.")
        else setDone(true)
      }}
    >
      <Input type="password" className="h-12 rounded-xl" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" minLength={8} required autoFocus />
      <Input type="password" className="h-12 rounded-xl" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" minLength={8} required />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={loading} className="mt-1 h-12 w-full rounded-xl text-base font-semibold">
        {loading ? "Saving…" : "Save new password"}
      </Button>
    </form>
  )
}
