"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { QRCodeSVG } from "qrcode.react"
import {
  ShieldCheck,
  ShieldOff,
  UserRound,
  Mail,
  Lock,
  Fingerprint,
  Trash2,
  Monitor,
  Loader2,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { updateUsername } from "@/app/actions/settings"
import type { SecurityActivityEvent } from "@/app/actions/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useT } from "@/components/locale-provider"
import { SettingsHeader, StatusPill, SectionLabel, SettingsRows, SettingsRow, Panel, FilterTabs } from "@/components/settings/chrome"

export function SecurityView({
  email,
  handle,
  hasPassword,
  twoFactorEnabled,
  oauthProviders,
  activity,
}: {
  email: string
  handle: string
  hasPassword: boolean
  twoFactorEnabled: boolean
  oauthProviders: string[]
  activity: SecurityActivityEvent[]
}) {
  const t = useT()
  const [sessionCount, setSessionCount] = useState<number | null>(null)

  return (
    <div className="space-y-6">
      <SettingsHeader
        icon={ShieldCheck}
        title={t("Security")}
        right={
          <>
            {twoFactorEnabled ? (
              <StatusPill icon={ShieldCheck} tone="success">
                {t("2FA On")}
              </StatusPill>
            ) : (
              <StatusPill icon={ShieldOff}>{t("2FA Off")}</StatusPill>
            )}
            <StatusPill icon={Monitor}>
              {sessionCount == null ? t("Sessions") : `${sessionCount} ${sessionCount === 1 ? t("Session") : t("Sessions")}`}
            </StatusPill>
            {oauthProviders.map((p) => (
              <StatusPill key={p}>
                <span className="inline-block size-2 rounded-full bg-primary" />
                {providerLabel(p)}
              </StatusPill>
            ))}
          </>
        }
      />

      <div className="space-y-3">
        <SectionLabel>{t("Account & Security")}</SectionLabel>
        <SettingsRows>
          <SettingsRow icon={UserRound} title={t("Change Username")} value={`@${handle}`}>
            <UsernameForm handle={handle} />
          </SettingsRow>

          <SettingsRow icon={Mail} title={t("Change Email")} value={email}>
            <EmailForm currentEmail={email} />
          </SettingsRow>

          <SettingsRow
            icon={Lock}
            title={hasPassword ? t("Change Password") : t("Set Password")}
            value={hasPassword ? undefined : t("Optional")}
          >
            <PasswordForm hasPassword={hasPassword} email={email} />
          </SettingsRow>

          <SettingsRow
            icon={ShieldCheck}
            title={t("Two-Factor Authentication")}
            value={twoFactorEnabled ? t("Enabled") : t("Disabled")}
          >
            <TwoFactorInline enabled={twoFactorEnabled} hasPassword={hasPassword} />
          </SettingsRow>

          <SettingsRow icon={Fingerprint} title={t("Passkeys")} value={t("Not set up")}>
            <PasskeysInline />
          </SettingsRow>

          <SettingsRow icon={Trash2} title={t("Delete Account")} tone="danger">
            <DeleteAccountInline hasPassword={hasPassword} />
          </SettingsRow>
        </SettingsRows>
      </div>

      <div className="space-y-3">
        <SectionLabel>{t("Sessions & Activity")}</SectionLabel>
        <div className="grid gap-4 xl:grid-cols-2">
          <ActiveSessionsPanel onCount={setSessionCount} />
          <LoginHistoryPanel activity={activity} />
        </div>
      </div>
    </div>
  )
}

// --- Account & Security row forms ------------------------------------------

function UsernameForm({ handle }: { handle: string }) {
  const t = useT()
  const router = useRouter()
  const [value, setValue] = useState(handle)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await updateUsername(value)
      toast.success(t("Username updated"))
      router.refresh()
    } catch {
      toast.error(t("Could not update username"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="username">{t("Username")}</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">@</span>
          <Input id="username" value={value} onChange={(e) => setValue(e.target.value)} className="max-w-xs" autoComplete="off" />
        </div>
        <p className="text-xs text-muted-foreground">{t("Letters, numbers, dots, dashes and underscores. Shown on your public profile.")}</p>
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? t("Saving…") : t("Save")}
      </Button>
    </form>
  )
}

function EmailForm({ currentEmail }: { currentEmail: string }) {
  const t = useT()
  const router = useRouter()
  const [email, setEmail] = useState(currentEmail)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (email === currentEmail) return
    setBusy(true)
    const { error } = await authClient.changeEmail({ newEmail: email })
    setBusy(false)
    if (error) {
      toast.error(error.message ? t(error.message) : t("Could not update email"))
      setEmail(currentEmail)
      return
    }
    toast.success(t("Check your inbox to confirm the new email."))
    router.refresh()
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("Email")}</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-sm" required />
      </div>
      <Button type="submit" size="sm" disabled={busy || email === currentEmail}>
        {busy ? t("Saving…") : t("Update email")}
      </Button>
    </form>
  )
}

function PasswordForm({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const t = useT()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)

  // OAuth-only accounts have no password: send a set-password (reset) email.
  if (!hasPassword) {
    async function sendLink() {
      setBusy(true)
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })
      setBusy(false)
      if (error) return toast.error(error.message ? t(error.message) : t("Could not send the link"))
      toast.success(t("We emailed you a link to set a password."))
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("Your account signs in with a connected provider. Add a password so you can also sign in with your email.")}
        </p>
        <Button size="sm" onClick={sendLink} disabled={busy}>
          {busy ? t("Sending…") : t("Email me a set-password link")}
        </Button>
      </div>
    )
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (next !== confirm) return toast.error(t("New passwords don't match"))
    setBusy(true)
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
    setBusy(false)
    if (error) return toast.error(error.message ? t(error.message) : t("Could not change password"))
    toast.success(t("Password changed. Other sessions were signed out."))
    setCurrent("")
    setNext("")
    setConfirm("")
  }

  return (
    <form onSubmit={save} className="max-w-sm space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="cur-pw">{t("Current password")}</Label>
        <Input id="cur-pw" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-pw">{t("New password")}</Label>
        <Input id="new-pw" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" minLength={8} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conf-pw">{t("Confirm new password")}</Label>
        <Input id="conf-pw" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" minLength={8} />
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? t("Saving…") : t("Change password")}
      </Button>
    </form>
  )
}

type TwoFAStep = { kind: "idle" } | { kind: "scan"; uri: string; backupCodes: string[] } | { kind: "codes"; backupCodes: string[] }

function TwoFactorInline({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const t = useT()
  const router = useRouter()
  const [step, setStep] = useState<TwoFAStep>({ kind: "idle" })
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  const pw = hasPassword ? { password } : {}
  const secret = step.kind === "scan" ? new URL(step.uri).searchParams.get("secret") : null

  async function run<T>(fn: () => Promise<{ data: T | null; error: { message?: string } | null }>) {
    setBusy(true)
    const { data, error } = await fn()
    setBusy(false)
    if (error) toast.error(error.message ? t(error.message) : t("That didn't work."))
    return error ? null : data
  }

  const passwordField = hasPassword && (
    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Your current password")} className="max-w-xs" required />
  )

  if (step.kind === "scan") {
    return (
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await run(() => authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") }))
          if (ok) {
            toast.success(t("Two-step verification is on."))
            setStep({ kind: "codes", backupCodes: step.backupCodes })
            setCode("")
            router.refresh()
          }
        }}
      >
        <p className="text-sm">{t("1. Scan this with your authenticator app.")}</p>
        <div className="inline-block rounded-lg bg-white p-3">
          <QRCodeSVG value={step.uri} size={148} />
        </div>
        {secret && (
          <p className="text-xs text-muted-foreground">
            {t("Can't scan? Enter this key instead:")} <span className="select-all font-mono text-foreground">{secret}</span>
          </p>
        )}
        <p className="text-sm">{t("2. Enter the 6-digit code it shows.")}</p>
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="max-w-32" required />
          <Button type="submit" size="sm" disabled={busy}>
            {t("Turn on")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStep({ kind: "idle" })}>
            {t("Cancel")}
          </Button>
        </div>
      </form>
    )
  }

  if (step.kind === "codes") {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t("Save these backup codes somewhere safe. Each one signs you in once if you lose your phone. They won't be shown again.")}</p>
        <div className="grid max-w-sm grid-cols-2 gap-1.5 rounded-lg bg-muted p-3 font-mono text-sm">
          {step.backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(step.backupCodes.join("\n")).then(() => toast.success(t("Copied.")))}>
            {t("Copy codes")}
          </Button>
          <Button size="sm" onClick={() => { setStep({ kind: "idle" }); setPassword("") }}>
            {t("I've saved them")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (enabled) {
          const ok = await run(() => authClient.twoFactor.disable(pw))
          if (ok) {
            toast.success(t("Two-step verification is off."))
            setPassword("")
            router.refresh()
          }
        } else {
          const data = await run(() => authClient.twoFactor.enable(pw))
          const d = data as { totpURI?: string; backupCodes?: string[] } | null
          if (d?.totpURI) setStep({ kind: "scan", uri: d.totpURI, backupCodes: d.backupCodes ?? [] })
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        {enabled
          ? t("On. Signing in with your password also asks for a code from your authenticator app.")
          : t("Add a code from an authenticator app (Google Authenticator, 1Password, Authy…) to your password sign-in.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {passwordField}
        <Button type="submit" size="sm" variant={enabled ? "outline" : "default"} disabled={busy}>
          {enabled ? t("Turn off") : t("Set up")}
        </Button>
        {enabled && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || (hasPassword && !password)}
            onClick={async () => {
              const data = await run(() => authClient.twoFactor.generateBackupCodes(pw))
              if (data) setStep({ kind: "codes", backupCodes: (data as { backupCodes: string[] }).backupCodes })
            }}
          >
            {t("New backup codes")}
          </Button>
        )}
      </div>
    </form>
  )
}

function PasskeysInline() {
  const t = useT()
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t("Sign in with Face ID, Touch ID or a security key instead of a password. We're finishing the passkey setup for your account.")}
      </p>
      <Button size="sm" variant="outline" disabled>
        {t("Add a passkey")}
      </Button>
    </div>
  )
}

function DeleteAccountInline({ hasPassword }: { hasPassword: boolean }) {
  const t = useT()
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmText, setConfirmText] = useState("")
  const [busy, setBusy] = useState(false)

  async function onDelete(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await authClient.deleteUser(hasPassword ? { password } : {})
    setBusy(false)
    if (error) return toast.error(error.message ? t(error.message) : t("Could not delete account"))
    toast.success(t("Account deleted"))
    router.push("/sign-in")
  }

  return (
    <form onSubmit={onDelete} className="max-w-sm space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("Permanently delete your account, trades, journal, and every setting. This can't be undone.")}
      </p>
      {hasPassword ? (
        <div className="space-y-1.5">
          <Label htmlFor="del-pw">{t("Confirm with your password")}</Label>
          <Input id="del-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="del-confirm">{t("Type DELETE to confirm")}</Label>
          <Input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
        </div>
      )}
      <Button type="submit" size="sm" variant="destructive" disabled={busy || (!hasPassword && confirmText !== "DELETE")}>
        {busy ? t("Deleting…") : t("Permanently delete my account")}
      </Button>
    </form>
  )
}

// --- Sessions & Activity ----------------------------------------------------

type SessionRow = { id: string; token: string; ipAddress?: string | null; userAgent?: string | null; updatedAt: string; createdAt: string }

function ActiveSessionsPanel({ onCount }: { onCount: (n: number) => void }) {
  const t = useT()
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [currentToken, setCurrentToken] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function load() {
    const [list, cur] = await Promise.all([authClient.listSessions(), authClient.getSession()])
    const rows = (list.data ?? []) as unknown as SessionRow[]
    setSessions(rows)
    setCurrentToken((cur.data?.session as { token?: string } | undefined)?.token ?? null)
    onCount(rows.length)
  }

  useEffect(() => {
    load().catch(() => setSessions([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function revoke(token: string) {
    setRevoking(token)
    const { error } = await authClient.revokeSession({ token })
    setRevoking(null)
    if (error) return toast.error(error.message ? t(error.message) : t("Could not sign out that session"))
    toast.success(t("Signed out that session"))
    load()
  }

  return (
    <Panel title={t("Active Sessions")}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-wider text-muted-foreground uppercase">
              <th className="px-2 py-1.5 text-start font-semibold">{t("Browser")}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{t("Location")}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{t("Last Active")}</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {sessions == null && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </td>
              </tr>
            )}
            {sessions?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t("No other sessions.")}
                </td>
              </tr>
            )}
            {sessions?.map((s) => {
              const current = s.token === currentToken
              return (
                <tr key={s.id} className="border-t">
                  <td className="px-2 py-2.5">
                    <span className="flex items-center gap-2">
                      <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{parseUserAgent(s.userAgent)}</span>
                      {current && (
                        <span className="rounded-full bg-[var(--gain)]/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[var(--gain)] uppercase">
                          {t("Current")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground">{s.ipAddress || t("Unknown")}</td>
                  <td className="px-2 py-2.5 text-muted-foreground" suppressHydrationWarning>
                    {current ? t("Just now") : relativeTime(s.updatedAt, t)}
                  </td>
                  <td className="px-2 py-2.5 text-end">
                    {!current && (
                      <button
                        type="button"
                        onClick={() => revoke(s.token)}
                        disabled={revoking === s.token}
                        className="text-xs font-medium text-[var(--loss)] hover:underline disabled:opacity-50"
                      >
                        {revoking === s.token ? t("Signing out…") : t("Sign out")}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

type HistoryFilter = "all" | "login" | "security"

function LoginHistoryPanel({ activity }: { activity: SecurityActivityEvent[] }) {
  const t = useT()
  const [filter, setFilter] = useState<HistoryFilter>("all")
  const rows = useMemo(() => (filter === "all" ? activity : activity.filter((a) => a.category === filter)), [activity, filter])

  return (
    <Panel
      title={t("Login History")}
      right={
        <FilterTabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: "all", label: t("All") },
            { value: "login", label: t("Logins") },
            { value: "security", label: t("Security") },
          ]}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-wider text-muted-foreground uppercase">
              <th className="px-2 py-1.5 text-start font-semibold">{t("Event")}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{t("IP")}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{t("When")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t("Nothing here yet.")}
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-2 py-2.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block size-2 shrink-0 rounded-full",
                        e.tone === "success" && "bg-[var(--gain)]",
                        e.tone === "danger" && "bg-[var(--loss)]",
                        e.tone === "muted" && "bg-muted-foreground/50",
                      )}
                    />
                    {t(e.label)}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-muted-foreground">{e.ip || "—"}</td>
                <td className="px-2 py-2.5 text-muted-foreground" suppressHydrationWarning>
                  {relativeTime(e.at, t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// --- helpers ----------------------------------------------------------------

function providerLabel(id: string): string {
  if (id === "google") return "Google"
  if (id === "github") return "GitHub"
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function parseUserAgent(ua?: string | null): string {
  if (!ua) return "Unknown device"
  const browser = /Edg/.test(ua) ? "Edge" : /OPR|Opera/.test(ua) ? "Opera" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Browser"
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "device"
  return `${browser} on ${os}`
}

function relativeTime(iso: string, t: (s: string, v?: Record<string, string | number>) => string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const m = Math.round(diff / 60000)
  if (m < 1) return t("Just now")
  if (m < 60) return t("{n}m ago", { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return t("{n}h ago", { n: h })
  const d = Math.round(h / 24)
  if (d < 30) return t("{n}d ago", { n: d })
  return new Date(iso).toLocaleDateString()
}
