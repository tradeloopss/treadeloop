"use client"

import type React from "react"
import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

export function ChangePasswordForm() {
  const t = useT()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (error) throw new Error(error.message ?? t("Could not change password"))
      toast.success(t("Password updated"))
      setCurrentPassword("")
      setNewPassword("")
    } catch (err) {
      toast.error(err instanceof Error ? t(err.message) : t("Could not change password"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-lg p-5">
      <h2 className="font-medium">{t("Password")}</h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">{t("Current password")}</Label>
          <Input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">{t("New password")}</Label>
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? t("Updating…") : t("Update password")}
        </Button>
      </form>
    </Card>
  )
}
