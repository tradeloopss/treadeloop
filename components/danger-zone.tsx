"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

export function DangerZone() {
  const router = useRouter()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [deleting, setDeleting] = useState(false)

  async function onDelete(e: React.FormEvent) {
    e.preventDefault()
    setDeleting(true)
    try {
      const { error } = await authClient.deleteUser({ password })
      if (error) throw new Error(error.message ?? t("Could not delete account"))
      toast.success(t("Account deleted"))
      router.push("/sign-in")
    } catch (err) {
      toast.error(err instanceof Error ? t(err.message) : t("Could not delete account"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className="max-w-lg border-destructive/30 p-5">
      <h2 className="font-medium text-destructive">{t("Danger zone")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("Permanently delete your account, trades, journal, and every setting. This can't be undone.")}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="destructive" className="mt-3">{t("Delete account")}</Button>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete your account?")}</DialogTitle>
            <DialogDescription>
              {t("This permanently deletes everything — trades, journal entries, playbooks, connected accounts. Confirm with your password.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onDelete} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="delete-password">{t("Password")}</Label>
              <Input
                id="delete-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={deleting} className="w-full">
                {deleting ? t("Deleting…") : t("Permanently delete my account")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
