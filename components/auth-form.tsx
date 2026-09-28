"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff, Check } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { updateUsername } from "@/app/actions/settings"
import { resolveLoginEmail } from "@/app/actions/auth-helpers"
import { BrandMark } from "@/components/brand-mark"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"

// Shared responsive palette: light + centered on mobile (matching the mock),
// dark split-screen on desktop. Colors are hardcoded (not theme tokens) because
// this branded auth screen looks the same regardless of the app theme.
const FIELD =
  "h-12 w-full rounded-xl border bg-white px-4 text-base text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 border-neutral-300 focus:border-neutral-900 lg:border-white/15 lg:bg-white/[0.04] lg:text-white lg:placeholder:text-white/40 lg:focus:border-white/50"
// Light/mobile: TradeLoop brand color. Desktop (dark side): white, per the mock.
const PRIMARY =
  "flex h-12 w-full items-center justify-center rounded-xl text-base font-semibold transition-colors disabled:opacity-60 bg-[#6d4aff] text-white hover:bg-[#5c3ce6] lg:bg-white lg:text-neutral-900 lg:hover:bg-white/90"
const SOCIAL =
  "flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border text-base font-medium transition-colors border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 lg:border-white/15 lg:bg-transparent lg:text-white lg:hover:bg-white/5"
const MUTED = "text-neutral-500 lg:text-white/50"
const ACCENT = "font-semibold text-neutral-900 hover:underline lg:text-white"

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

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-5" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  show,
  onToggle,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  show: boolean
  onToggle: () => void
}) {
  const t = useT()
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} minLength={8} required autoComplete={id === "password" ? "current-password" : "new-password"} className={cn(FIELD, "pe-11")} />
      <button type="button" onClick={onToggle} aria-label={show ? t("Hide password") : t("Show password")} className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 lg:text-white/40 lg:hover:text-white/70">
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  )
}

function Box({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
        checked ? "border-neutral-900 bg-neutral-900 text-white lg:border-white lg:bg-white lg:text-neutral-900" : "border-neutral-300 lg:border-white/25",
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  )
}

export function AuthForm({
  mode,
  redirectTo = "/dashboard",
  googleEnabled = false,
  githubEnabled = false,
}: {
  mode: "sign-in" | "sign-up"
  redirectTo?: string
  googleEnabled?: boolean
  githubEnabled?: boolean
}) {
  const router = useRouter()
  const t = useT()
  const isSignUp = mode === "sign-up"

  const [step, setStep] = useState<"form" | "verify">("form")
  const [email, setEmail] = useState("") // sign-in: "Email or Username"; sign-up: email
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [remember, setRemember] = useState(true)
  const [agree, setAgree] = useState(false)
  const [otp, setOtp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [social, setSocial] = useState<"google" | "github" | null>(null)
  const [resent, setResent] = useState(false)

  async function onSocial(provider: "google" | "github") {
    const label = provider === "google" ? "Google" : "GitHub"
    setError(null)
    setSocial(provider)
    try {
      const { error } = await authClient.signIn.social({ provider, callbackURL: redirectTo })
      if (error) throw new Error(error.message ?? t("Could not continue with {provider}", { provider: label }))
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("Could not continue with {provider}", { provider: label }))
      setSocial(null)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (isSignUp) {
      if (!agree) return setError(t("Please agree to the Terms and Privacy Policy"))
      if (password !== confirm) return setError(t("Passwords don't match"))
    }
    setLoading(true)
    try {
      if (isSignUp) {
        const handle = (username.trim() || email.split("@")[0]).toLowerCase()
        const { error } = await authClient.signUp.email({ email: email.trim(), password, name: username.trim() || handle })
        if (error) {
          if (/exist/i.test(error.message ?? "")) throw new Error(t("An account with this email already exists — try signing in instead."))
          throw new Error(error.message ?? t("Could not create account"))
        }
        // The account now exists and (autoSignIn) the user is signed in. Save
        // the chosen @handle — best-effort.
        try {
          await updateUsername(handle)
        } catch {
          /* handle can be set later in Settings */
        }
        // Email verification is best-effort: only gate on the code if we could
        // actually send it. If email delivery isn't configured (or the send
        // fails), don't strand the already-created, already-signed-in user on a
        // code screen — send them straight to the dashboard. (Otherwise they'd
        // hit "User already exists" if they retried the same email.)
        let otpSent = false
        try {
          const { error: otpErr } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" })
          otpSent = !otpErr
        } catch {
          otpSent = false
        }
        if (otpSent) {
          setStep("verify")
          return
        }
        router.push(redirectTo)
        router.refresh()
        return
      }
      // Sign in — accept an email or a username.
      const resolved = await resolveLoginEmail(email)
      if (!resolved) throw new Error(t("Invalid email or password"))
      const { data, error } = await authClient.signIn.email({ email: resolved, password, rememberMe: remember })
      if (error) throw new Error(error.message ?? t("Invalid email or password"))
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("Something went wrong"))
    } finally {
      setLoading(false)
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: otp.replace(/\s/g, "") })
      if (error) throw new Error(error.message ?? t("That code didn't work. Please try again."))
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("That code didn't work. Please try again."))
    } finally {
      setLoading(false)
    }
  }

  async function onResend() {
    setError(null)
    setResent(false)
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" })
      if (error) throw new Error(error.message ?? t("Could not resend the code"))
      setResent(true)
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("Could not resend the code"))
    }
  }

  const heading = step === "verify" ? t("Verify your email") : isSignUp ? t("Create account") : t("Sign in")
  const subtitle =
    step === "verify" ? t("Enter the 6-digit code we sent to {email}", { email }) : isSignUp ? t("Start journaling your trades") : t("Welcome back")

  return (
    <div className="min-h-svh bg-white text-neutral-900 lg:bg-[oklch(0.17_0.015_285)] lg:text-white">
      <div className="lg:grid lg:min-h-svh lg:grid-cols-2">
        {/* Hero — desktop only */}
        <aside className="relative hidden overflow-hidden bg-[oklch(0.17_0.015_285)] px-10 py-12 lg:flex lg:flex-col lg:justify-center lg:border-e lg:border-white/10 xl:px-16">
          <div className="flex items-center gap-2">
            <BrandMark className="size-8" alt="TradeLoop" />
            <span className="text-lg font-semibold tracking-wide text-white uppercase">TradeLoop</span>
          </div>
          <h2 className="mt-14 text-5xl font-extrabold uppercase leading-[1.03] tracking-tight text-white xl:text-6xl">
            {t("Journal your trades.")}
            <br />
            {t("Master your edge.")}
          </h2>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
            <span>{t("#1 Prop Firm Journal")}</span>
            <span aria-hidden>•</span>
            <span>{t("Auto-Sync")}</span>
            <span aria-hidden>•</span>
            <span>{t("Free Plan")}</span>
          </div>
          <HeroPreview />
        </aside>

        {/* Form column */}
        <main className="flex min-h-svh flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-24">
          <div className="mx-auto w-full max-w-md lg:mx-0">
            {/* Logo — centered on mobile only (the hero carries it on desktop) */}
            <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
              <BrandMark className="size-8" alt="TradeLoop" />
              <span className="text-lg font-semibold tracking-wide uppercase">TradeLoop</span>
            </div>

            <h1 className="text-center text-3xl font-extrabold uppercase tracking-tight sm:text-4xl lg:text-left">{heading}</h1>
            <p className={cn("mt-2 text-center text-sm lg:text-left", MUTED)}>{subtitle}</p>

            {step === "verify" ? (
              <form onSubmit={onVerify} className="mt-8 space-y-4">
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  required
                  className={cn(FIELD, "text-center text-2xl tracking-[0.5em]")}
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                {resent && <p className="text-sm text-emerald-500">{t("A new code is on its way.")}</p>}
                <button type="submit" disabled={loading} className={PRIMARY}>
                  {loading ? t("Verifying…") : t("Verify email")}
                </button>
                <p className={cn("text-center text-sm", MUTED)}>
                  {t("Didn't get it?")}{" "}
                  <button type="button" onClick={onResend} className={ACCENT}>
                    {t("Resend code")}
                  </button>
                </p>
              </form>
            ) : (
              <>
                <form onSubmit={onSubmit} className="mt-8 space-y-3">
                  <input
                    type={isSignUp ? "email" : "text"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={isSignUp ? t("Email") : t("Email or Username")}
                    autoComplete={isSignUp ? "email" : "username"}
                    required
                    className={FIELD}
                  />

                  {isSignUp && (
                    <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("Username")} autoComplete="username" className={FIELD} />
                  )}

                  <PasswordField id="password" value={password} onChange={setPassword} placeholder={isSignUp ? t("Password (min 8 characters)") : t("Password")} show={showPw} onToggle={() => setShowPw((s) => !s)} />

                  {isSignUp && (
                    <PasswordField id="confirm" value={confirm} onChange={setConfirm} placeholder={t("Confirm Password")} show={showConfirm} onToggle={() => setShowConfirm((s) => !s)} />
                  )}

                  {isSignUp ? (
                    <label className="flex items-start gap-2.5 pt-1 text-sm">
                      <Box checked={agree} onChange={() => setAgree((a) => !a)} />
                      <span className={MUTED}>
                        {t("I agree to the")}{" "}
                        <Link href="/terms" className={ACCENT}>{t("Terms")}</Link> {t("and")}{" "}
                        <Link href="/privacy" className={ACCENT}>{t("Privacy Policy")}</Link>
                      </span>
                    </label>
                  ) : (
                    <div className="flex items-center justify-between pt-1 text-sm">
                      <label className="flex items-center gap-2.5">
                        <Box checked={remember} onChange={() => setRemember((r) => !r)} />
                        <span className={MUTED}>{t("Remember me")}</span>
                      </label>
                      <Link href={`/forgot-password${email && email.includes("@") ? `?email=${encodeURIComponent(email)}` : ""}`} className={cn(MUTED, "hover:underline")}>
                        {t("Forgot?")}
                      </Link>
                    </div>
                  )}

                  {error && <p className="text-sm text-red-500">{error}</p>}

                  <button type="submit" disabled={loading} className={cn(PRIMARY, "mt-1")}>
                    {loading ? t("Please wait…") : isSignUp ? t("Create Account") : t("Sign In")}
                  </button>
                </form>

                {(googleEnabled || githubEnabled) && (
                  <>
                    <div className="my-6 flex items-center gap-3">
                      <span className="h-px flex-1 bg-neutral-200 lg:bg-white/10" />
                      <span className="text-xs font-medium text-neutral-400 lg:text-white/40">{t("OR")}</span>
                      <span className="h-px flex-1 bg-neutral-200 lg:bg-white/10" />
                    </div>
                    <div className="space-y-3">
                      {googleEnabled && (
                        <button type="button" onClick={() => onSocial("google")} disabled={social != null || loading} className={SOCIAL}>
                          <GoogleMark />
                          {social === "google" ? t("Redirecting…") : t("Continue with Google")}
                        </button>
                      )}
                      {githubEnabled && (
                        <button type="button" onClick={() => onSocial("github")} disabled={social != null || loading} className={SOCIAL}>
                          <GithubMark />
                          {social === "github" ? t("Redirecting…") : t("Continue with GitHub")}
                        </button>
                      )}
                    </div>
                  </>
                )}

                <p className={cn("mt-6 text-center text-xs", MUTED)}>
                  {t("By continuing, you agree to our")}{" "}
                  <Link href="/terms" className="underline underline-offset-2">{t("Terms")}</Link> {t("and")}{" "}
                  <Link href="/privacy" className="underline underline-offset-2">{t("Privacy Policy")}</Link>.
                </p>

                <p className={cn("mt-5 text-center text-sm", MUTED)}>
                  {isSignUp ? t("Already have an account?") : t("Don't have an account?")}{" "}
                  <Link href={`${isSignUp ? "/sign-in" : "/sign-up"}${redirectTo !== "/dashboard" ? `?next=${encodeURIComponent(redirectTo)}` : ""}`} className={ACCENT}>
                    {isSignUp ? t("Sign in") : t("Sign up")}
                  </Link>
                </p>

                {isSignUp && (
                  <p className={cn("mt-4 text-center text-xs", MUTED)}>
                    <Link href="/terms" className="underline underline-offset-2">{t("Impressum")}</Link>
                    {" · "}
                    <Link href="/privacy" className="underline underline-offset-2">{t("Risk Disclosure")}</Link>
                  </p>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

// A small abstract dashboard behind the hero copy — evokes the product without
// shipping a screenshot asset. Muted greens/reds on near-black.
function HeroPreview() {
  return (
    <div className="mt-10 hidden overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-3 lg:block">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="h-2 w-16 rounded bg-white/10" />
          <div className="mt-2 h-3 w-24 rounded bg-emerald-500/30" />
          <svg viewBox="0 0 120 40" className="mt-3 h-10 w-full" preserveAspectRatio="none" aria-hidden>
            <polyline points="0,34 20,30 40,32 60,20 80,22 100,10 120,6" fill="none" stroke="rgb(16 185 129 / 0.5)" strokeWidth="2" />
          </svg>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="h-2 w-8 rounded bg-white/10" />
          <div className="mt-2 h-3 w-10 rounded bg-white/15" />
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="h-2 w-8 rounded bg-white/10" />
          <div className="mt-2 h-3 w-10 rounded bg-emerald-500/30" />
        </div>
        <div className="col-span-4 grid grid-cols-12 gap-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className={cn("h-3 rounded-sm", i % 5 === 0 ? "bg-red-500/25" : i % 3 === 0 ? "bg-emerald-500/40" : "bg-white/[0.06]")} />
          ))}
        </div>
      </div>
    </div>
  )
}
