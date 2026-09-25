"use client"

import type React from "react"
import { useTransition } from "react"
import { createAccount, updateAccount } from "@/app/actions/accounts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"
import type { HubAccount } from "@/components/accounts/types"

// Account editing, moved here from Settings → Accounts (the old
// AccountManager); the server actions are unchanged.

export function EditAccountDialog({
  account,
  mode,
  onClose,
}: {
  account: HubAccount | null
  mode: "edit" | "balance"
  onClose: () => void
}) {
  const t = useT()
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!account) return
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        if (mode === "balance") {
          await updateAccount(account.id, { startingBalance: Number(fd.get("startingBalance")), currency: String(fd.get("currency") ?? "") })
        } else {
          const commRaw = String(fd.get("commissionPerContract") ?? "").trim()
          await updateAccount(account.id, {
            name: String(fd.get("name") ?? ""),
            broker: String(fd.get("broker") ?? ""),
            commissionPerContract: commRaw === "" ? null : Number(commRaw),
          })
        }
        toast.success(t("Account updated"))
        onClose()
      } catch {
        toast.error(t("Could not update account"))
      }
    })
  }

  return (
    <Dialog open={account != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {account && (
          <>
            <DialogHeader>
              <DialogTitle>{mode === "balance" ? t("Edit balance") : t("Edit account")}</DialogTitle>
              <DialogDescription>
                {mode === "balance"
                  ? t("Set the account's starting balance — your equity and drawdown are measured from it.")
                  : t("Rename the account or change its broker label.")}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <fieldset disabled={pending} className="space-y-4">
                {mode === "balance" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="edit-balance" className="text-xs font-semibold">{t("Starting balance")}</Label>
                      <Input id="edit-balance" name="startingBalance" type="number" step="0.01" defaultValue={account.startingBalance} className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-currency" className="text-xs font-semibold">{t("Currency")}</Label>
                      <Input id="edit-currency" name="currency" defaultValue={account.currency} maxLength={3} className="h-10 uppercase" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="edit-name" className="text-xs font-semibold">{t("Name")}</Label>
                      <Input id="edit-name" name="name" defaultValue={account.name} required className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-broker" className="text-xs font-semibold">{t("Broker / prop firm")}</Label>
                      <Input id="edit-broker" name="broker" defaultValue={account.broker ?? ""} placeholder={t("Tradovate, NinjaTrader, Apex, TopStep…")} className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-commission" className="text-xs font-semibold">{t("Commission per contract (round-turn)")}</Label>
                      <Input id="edit-commission" name="commissionPerContract" type="number" step="0.01" min="0" defaultValue={account.commissionPerContract ?? ""} placeholder={t("e.g. 1.82 — leave blank for auto")} className="h-10" />
                      <p className="text-xs text-muted-foreground">{t("Applied to every trade so P&L is net, matching your broker. Auto-filled from Rithmic when available.")}</p>
                    </div>
                  </>
                )}
              </fieldset>
              <DialogFooter>
                <Button type="submit" disabled={pending} className="h-11 w-full">
                  {pending ? t("Saving…") : t("Save")}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function CreateManualAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await createAccount(formData)
        toast.success(t("Account added"))
        onOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not add account"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Add a manual account")}</DialogTitle>
          <DialogDescription>{t("For trades you log yourself. Give it a name you'll recognize when logging trades.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset disabled={pending} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-name" className="text-xs font-semibold">{t("Name")}</Label>
              <Input id="new-name" name="name" placeholder={t("Apex 50K, Main Tradovate, IBKR…")} required className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-broker" className="text-xs font-semibold">{t("Broker / prop firm")}</Label>
              <Input id="new-broker" name="broker" placeholder={t("Tradovate, NinjaTrader, Apex, TopStep…")} className="h-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-balance" className="text-xs font-semibold">{t("Starting balance")}</Label>
                <Input id="new-balance" name="startingBalance" type="number" step="0.01" defaultValue="0" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-currency" className="text-xs font-semibold">{t("Currency")}</Label>
                <Input id="new-currency" name="currency" defaultValue="USD" maxLength={3} className="h-10 uppercase" />
              </div>
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={pending} className="h-11 w-full">
              {pending ? t("Adding…") : t("Add account")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Confirmation before a destructive or hard-to-undo action.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="h-11" onClick={onCancel} disabled={pending}>
            {t("Cancel")}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} className="h-11" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
