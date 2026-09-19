"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { addTeamMember, createAnnouncement, setUserRole } from "@/app/actions/admin"
import { ADMIN_ROLES, ROLE_LABELS, type AdminRole } from "@/lib/admin/roles"

const selectClass = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"

export function AnnouncementForm() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState("")
  const [level, setLevel] = useState<"info" | "warning">("info")
  const [endsAt, setEndsAt] = useState("")

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          // datetime-local has no zone; read it as the admin's local time.
          const result = await createAnnouncement(message, level, endsAt ? new Date(endsAt).toISOString() : null)
          if (result.ok) {
            toast.success("Announcement is live.")
            setMessage("")
            setEndsAt("")
          } else toast.error(result.error)
        })
      }}
    >
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={280}
        rows={3}
        placeholder="e.g. Rithmic sync is paused tonight 22:00–23:00 UTC for maintenance."
        required
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Style
          <select value={level} onChange={(e) => setLevel(e.target.value as "info" | "warning")} className={selectClass}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Hide automatically after (optional)
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-9" />
        </label>
        <span className="flex-1 text-right text-xs text-muted-foreground">{message.length}/280</span>
        <Button type="submit" disabled={pending}>
          Publish
        </Button>
      </div>
    </form>
  )
}

export function RoleSelect({ userId, role, disabled }: { userId: string; role: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition()
  return (
    <select
      defaultValue={role}
      disabled={disabled || pending}
      className={selectClass}
      onChange={(e) => {
        const next = e.target.value as AdminRole | "user"
        if (next === "user" && !confirm("Remove this person's admin access?")) {
          e.target.value = role
          return
        }
        startTransition(async () => {
          const result = await setUserRole(userId, next)
          if (result.ok) toast.success(next === "user" ? "Admin access removed." : `Role changed to ${ROLE_LABELS[next as AdminRole]}.`)
          else {
            toast.error(result.error)
            e.target.value = role
          }
        })
      }}
    >
      {ADMIN_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
      <option value="user">Remove admin access</option>
    </select>
  )
}

export function AddTeamMember() {
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<AdminRole>("support")
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const result = await addTeamMember(email, role)
          if (result.ok) {
            toast.success(`${email} is now ${ROLE_LABELS[role]}.`)
            setEmail("")
          } else toast.error(result.error)
        })
      }}
    >
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-muted-foreground">
        Email of an existing TradeLoop account
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className={selectClass}>
          {ADMIN_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending}>
        Add to team
      </Button>
    </form>
  )
}
