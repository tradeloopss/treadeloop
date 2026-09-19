"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { ShieldCheck, ShieldOff } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Step = { kind: "idle" } | { kind: "scan"; uri: string; backupCodes: string[] } | { kind: "codes"; backupCodes: string[] }

// Settings → Security: turn on authenticator-app 2FA (scan, confirm a code,
// save backup codes), turn it off, or get fresh backup codes.
export function TwoFactorPanel({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ kind: "idle" })
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  const pw = hasPassword ? { password } : {}
  const secret = step.kind === "scan" ? new URL(step.uri).searchParams.get("secret") : null

  async function run<T>(fn: () => Promise<{ data: T | null; error: { message?: string } | null }>) {
    setBusy(true)
    const { data, error } = await fn()
    setBusy(false)
    if (error) toast.error(error.message ?? "That didn't work.")
    return error ? null : data
  }

  const passwordField = hasPassword && (
    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your current password" className="max-w-xs" required />
  )

  return (
    <Card className="mt-6 max-w-lg gap-0 p-5">
      <div className="flex items-start gap-3">
        {enabled ? <ShieldCheck className="mt-0.5 size-5 text-[var(--gain)]" /> : <ShieldOff className="mt-0.5 size-5 text-muted-foreground" />}
        <div>
          <h2 className="font-medium">Two-step verification</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {enabled
              ? "On. Signing in with your password also asks for a code from your authenticator app."
              : "Add a code from an authenticator app (Google Authenticator, 1Password, Authy…) to your password sign-in."}
          </p>
        </div>
      </div>

      {step.kind === "idle" && (
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (enabled) {
              const ok = await run(() => authClient.twoFactor.disable(pw))
              if (ok) {
                toast.success("Two-step verification is off.")
                setPassword("")
                router.refresh()
              }
            } else {
              const data = await run(() => authClient.twoFactor.enable(pw))
              if (data && "totpURI" in data) setStep({ kind: "scan", uri: data.totpURI, backupCodes: data.backupCodes })
            }
          }}
        >
          {passwordField}
          <Button type="submit" variant={enabled ? "outline" : "default"} disabled={busy}>
            {enabled ? "Turn off" : "Set up"}
          </Button>
          {enabled && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy || (hasPassword && !password)}
              onClick={async () => {
                const data = await run(() => authClient.twoFactor.generateBackupCodes(pw))
                if (data) setStep({ kind: "codes", backupCodes: data.backupCodes })
              }}
            >
              New backup codes
            </Button>
          )}
        </form>
      )}

      {step.kind === "scan" && (
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const ok = await run(() => authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") }))
            if (ok) {
              toast.success("Two-step verification is on.")
              setStep({ kind: "codes", backupCodes: step.backupCodes })
              setCode("")
              router.refresh()
            }
          }}
        >
          <p className="text-sm">1. Scan this with your authenticator app.</p>
          <div className="inline-block rounded-lg bg-white p-3">
            <QRCodeSVG value={step.uri} size={168} />
          </div>
          {secret && (
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key instead: <span className="select-all font-mono text-foreground">{secret}</span>
            </p>
          )}
          <p className="text-sm">2. Enter the 6-digit code it shows.</p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="max-w-40" required />
            <Button type="submit" disabled={busy}>
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step.kind === "codes" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            Save these backup codes somewhere safe. Each one signs you in once if you lose your phone. They won&apos;t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-3 font-mono text-sm">
            {step.backupCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(step.backupCodes.join("\n")).then(() => toast.success("Copied."))
              }}
            >
              Copy codes
            </Button>
            <Button
              onClick={() => {
                setStep({ kind: "idle" })
                setPassword("")
              }}
            >
              I&apos;ve saved them
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
