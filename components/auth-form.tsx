"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { TrendingUp } from "lucide-react"

// Google's own mark, required by their branding guidelines on any
// "Sign in with Google" button.
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  )
}

export function AuthForm({
  mode,
  redirectTo = "/dashboard",
  googleEnabled = false,
}: {
  mode: "sign-in" | "sign-up"
  redirectTo?: string
  googleEnabled?: boolean
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const isSignUp = mode === "sign-up"

  async function onGoogle() {
    setError(null)
    setGoogleLoading(true)
    try {
      // Better Auth redirects the browser to Google, so on success this call
      // never returns — only the failure path needs handling here.
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: redirectTo })
      if (error) throw new Error(error.message ?? "Could not continue with Google")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue with Google")
      setGoogleLoading(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (isSignUp) {
        const { error } = await authClient.signUp.email({ email, password, name })
        if (error) throw new Error(error.message ?? "Could not create account")
      } else {
        const { error } = await authClient.signIn.email({ email, password })
        if (error) throw new Error(error.message ?? "Invalid email or password")
      }
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <TrendingUp className="size-7" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">{isSignUp ? "Welcome to TradeLoop" : "Sign in"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Journal smarter. Trade with clarity.</p>
        </div>

        {googleEnabled && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={onGoogle}
              disabled={googleLoading || loading}
              className="mt-7 h-12 w-full rounded-xl text-base font-medium"
            >
              <GoogleMark />
              {googleLoading ? "Redirecting…" : `Continue with Google`}
            </Button>
            <div className="mt-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={onSubmit} className={cn("flex flex-col gap-3", googleEnabled ? "mt-5" : "mt-7")}>
          {isSignUp && (
            <div>
              <Label htmlFor="name" className="sr-only">Name</Label>
              <Input id="name" className="h-12 rounded-xl" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
            </div>
          )}
          <div>
            <Label htmlFor="email" className="sr-only">Email</Label>
            <Input
              id="email"
              type="email"
              className="h-12 rounded-xl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
          </div>
          <div>
            <Label htmlFor="password" className="sr-only">{isSignUp ? "Create password" : "Password"}</Label>
            <Input
              id="password"
              type="password"
              className="h-12 rounded-xl"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? "Create password" : "Password"}
              minLength={8}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="mt-2 h-12 w-full rounded-xl text-base font-semibold">
            {loading ? "Please wait…" : isSignUp ? "Sign up" : "Sign in"}
          </Button>
        </form>

        {isSignUp && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="font-medium text-primary hover:underline">Terms of Service</Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>
          </p>
        )}

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {isSignUp ? "Already have an account? " : "Don't have an account? "}
          <Link
            href={`${isSignUp ? "/sign-in" : "/sign-up"}${redirectTo !== "/dashboard" ? `?next=${encodeURIComponent(redirectTo)}` : ""}`}
            className="font-medium text-primary hover:underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </Link>
        </p>
      </div>
    </div>
  )
}
