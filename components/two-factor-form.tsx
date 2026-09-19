"use client"

import { useState } from "react"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT } from "@/components/locale-provider"

export function TwoFactorForm({ next }: { next: string }) {
  const t = useT()
  const [useBackup, setUseBackup] = useState(false)
  const [code, setCode] = useState("")
  const [trustDevice, setTrustDevice] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice })
    if (error) {
      setLoading(false)
      setError(
        error.status === 401 && /session|cookie|expired/i.test(error.message ?? "")
          ? t("This sign-in expired. Go back and sign in again.")
          : (error.message ? t(error.message) : t("That code didn't work."))
      )
      return
    }
    // Full load so every server component sees the new session.
    window.location.href = next
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Input
        autoFocus
        className="h-12 rounded-xl text-center text-lg tracking-[0.3em]"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={useBackup ? t("backup code") : "123456"}
        inputMode={useBackup ? "text" : "numeric"}
        autoComplete="one-time-code"
        aria-label={useBackup ? t("Backup code") : t("Authentication code")}
        required
      />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        {t("Don't ask again on this device for 30 days")}
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={loading} className="mt-1 h-12 w-full rounded-xl text-base font-semibold">
        {loading ? t("Checking…") : t("Verify")}
      </Button>
      <div className="mt-2 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => {
            setUseBackup(!useBackup)
            setCode("")
            setError(null)
          }}
          className="font-medium text-primary hover:underline"
        >
          {useBackup ? t("Use authenticator code") : t("Use a backup code")}
        </button>
        <Link href="/sign-in" className="text-muted-foreground hover:text-foreground">
          {t("Back to sign in")}
        </Link>
      </div>
    </form>
  )
}
