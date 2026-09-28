"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Ban, Gift, KeyRound, LogIn, LogOut, ShieldCheck, ShieldOff, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteUser, grantPlan, impersonateUser, resetTwoFactor, revokeUserSessions, sendPasswordResetEmail, suspendUser, unsuspendUser, type ActionResult } from "@/app/actions/admin"

type Panel = "suspend" | "grant" | "delete" | null

export function UserActions({
  userId,
  userLabel,
  userEmail,
  banned,
  isSelf,
  twoFactorEnabled,
  hasPassword,
  can,
}: {
  userId: string
  userLabel: string
  banned: boolean
  isSelf: boolean
  twoFactorEnabled: boolean
  hasPassword: boolean
  can: { impersonate: boolean; ban: boolean; revoke: boolean; grant: boolean; security: boolean; delete: boolean }
  userEmail: string
}) {
  const [pending, startTransition] = useTransition()
  const [panel, setPanel] = useState<Panel>(null)
  const [reason, setReason] = useState("")
  const [days, setDays] = useState("")
  const [plan, setPlan] = useState<"essential" | "pro">("pro")
  const [grantDays, setGrantDays] = useState("30")
  const [note, setNote] = useState("")
  const [confirmText, setConfirmText] = useState("")

  function perform(action: () => Promise<ActionResult | undefined>, success: string) {
    startTransition(async () => {
      const result = await action()
      // impersonateUser redirects on success, so it only returns on failure.
      if (!result) return
      if (result.ok) {
        toast.success(result.message ?? success)
        setPanel(null)
      } else toast.error(result.error)
    })
  }

  if (isSelf) return <p className="text-sm text-muted-foreground">This is your own account.</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {can.impersonate && (
          <Button
            variant="outline"
            disabled={pending || banned}
            title={banned ? "Unsuspend the account first" : undefined}
            onClick={() => {
              if (confirm(`Log in as ${userLabel}? You'll see exactly what they see for up to 30 minutes. This is recorded in the audit log.`))
                perform(() => impersonateUser(userId), "")
            }}
          >
            <LogIn className="size-4" /> Log in as user
          </Button>
        )}
        {can.revoke && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (confirm(`Sign ${userLabel} out of every device?`)) perform(() => revokeUserSessions(userId), "Signed out everywhere.")
            }}
          >
            <LogOut className="size-4" /> Sign out everywhere
          </Button>
        )}
        {can.security && hasPassword && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (confirm(`Email ${userLabel} a link to choose a new password?`)) perform(() => sendPasswordResetEmail(userId), "Reset link sent.")
            }}
          >
            <KeyRound className="size-4" /> Send password reset
          </Button>
        )}
        {can.security && twoFactorEnabled && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (confirm(`Remove two-step verification from ${userLabel}? Only do this after confirming it's really them — e.g. they lost their phone.`))
                perform(() => resetTwoFactor(userId), "2FA removed.")
            }}
          >
            <ShieldOff className="size-4" /> Reset 2FA
          </Button>
        )}
        {can.grant && (
          <Button variant="outline" disabled={pending} onClick={() => setPanel(panel === "grant" ? null : "grant")}>
            <Gift className="size-4" /> Grant plan
          </Button>
        )}
        {can.ban &&
          (banned ? (
            <Button variant="outline" disabled={pending} onClick={() => perform(() => unsuspendUser(userId), "Account unsuspended.")}>
              <ShieldCheck className="size-4" /> Unsuspend
            </Button>
          ) : (
            <Button variant="destructive" disabled={pending} onClick={() => setPanel(panel === "suspend" ? null : "suspend")}>
              <Ban className="size-4" /> Suspend
            </Button>
          ))}
        {can.delete && (
          <Button variant="destructive" disabled={pending} onClick={() => { setConfirmText(""); setPanel(panel === "delete" ? null : "delete") }}>
            <Trash2 className="size-4" /> Delete account
          </Button>
        )}
      </div>

      {panel === "delete" && (
        <form
          className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => deleteUser(userId), "Account deleted.")
          }}
        >
          <p className="text-sm">
            <span className="font-semibold text-destructive">Permanently delete {userLabel}</span> and everything they own — trades, journal,
            connected accounts, subscription and settings. This can&apos;t be undone. The email is freed, so they can sign up again fresh.
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Type the account email <span className="font-mono text-foreground">{userEmail}</span> to confirm
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={userEmail} autoComplete="off" />
          </label>
          <Button type="submit" variant="destructive" disabled={pending || confirmText.trim().toLowerCase() !== userEmail.toLowerCase()}>
            {pending ? "Deleting…" : "Permanently delete account"}
          </Button>
        </form>
      )}

      {panel === "suspend" && (
        <form
          className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-[1fr_140px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => suspendUser(userId, reason, days ? Number(days) : null), "Account suspended and signed out.")
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Reason (shown only to admins)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. chargeback, abuse" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Days (blank = until lifted)
            <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <Button type="submit" variant="destructive" disabled={pending}>
            Suspend account
          </Button>
        </form>
      )}

      {panel === "grant" && (
        <form
          className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-[140px_120px_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            perform(() => grantPlan(userId, plan, Number(grantDays), note), "Plan granted.")
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Plan
            <select value={plan} onChange={(e) => setPlan(e.target.value as "essential" | "pro")} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground">
              <option value="pro">Pro</option>
              <option value="essential">Essential</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            For how many days
            <Input type="number" min={1} max={3650} value={grantDays} onChange={(e) => setGrantDays(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Note for the audit log
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. trial extension, partner account" />
          </label>
          <Button type="submit" disabled={pending}>
            Grant
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-4">
            Gives access without a Whop payment and ends on its own after that many days. It doesn&apos;t change anything in Whop.
          </p>
        </form>
      )}
    </div>
  )
}
