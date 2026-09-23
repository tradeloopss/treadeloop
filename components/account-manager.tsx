"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import Image from "next/image"
import { brokerLogo } from "@/lib/broker-logos"
import { createAccount, deleteAccount, updateAccount, setAccountArchived } from "@/app/actions/accounts"
import { syncRithmicAccount } from "@/app/actions/rithmic"
import { formatCurrency } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plus, Trash2, Wallet, MoreVertical, ExternalLink, Pencil, Upload, PenLine, SlidersHorizontal, Archive, ArchiveRestore, RefreshCw, ArrowLeft, Zap } from "lucide-react"
import { ConnectForm } from "@/components/rithmic-connect"
import { toast } from "sonner"
import { useIntlLocale, useT } from "@/components/locale-provider"

// A generic initial-avatar chip for the Broker column — not a real broker
// logo (we don't have licensed rights to those), just a deterministic color
// per name so the same broker always gets the same chip.
const CHIP_COLORS = [
  "bg-blue-500/15 text-blue-500",
  "bg-emerald-500/15 text-emerald-500",
  "bg-violet-500/15 text-violet-500",
  "bg-amber-500/15 text-amber-500",
  "bg-rose-500/15 text-rose-500",
  "bg-cyan-500/15 text-cyan-500",
]
function brokerChipColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return CHIP_COLORS[Math.abs(hash) % CHIP_COLORS.length]
}

export interface AccountCard {
  id: number
  name: string
  broker: string | null
  startingBalance: string
  currentBalance: string | null
  currency: string
  isLiveSynced: boolean
  canSync?: boolean
  archived?: boolean
  lastSyncedAt: Date | null
  lastSyncStatus: string | null
}

export function AccountManager({ accounts, isPro }: { accounts: AccountCard[]; isPro: boolean }) {
  const t = useT()
  const dateLocale = useIntlLocale()
  const [open, setOpen] = useState(false)
  // The Add Account dialog first asks how: manual entry or auto-sync (connect a
  // broker). Resets to the choice each time it opens.
  const [addMode, setAddMode] = useState<"choice" | "manual" | "auto">("choice")
  const [pending, startTransition] = useTransition()

  function openAddDialog(o: boolean) {
    setOpen(o)
    if (o) setAddMode("choice")
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await createAccount(formData)
        toast.success(t("Account added"))
        setOpen(false)
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not add account"))
      }
    })
  }

  const [editing, setEditing] = useState<{ account: AccountCard; mode: "edit" | "balance" } | null>(null)

  function onDelete(id: number, name: string) {
    startTransition(async () => {
      try {
        await deleteAccount(id)
        toast.success(t("Removed {name}", { name }))
      } catch {
        toast.error(t("Could not remove account"))
      }
    })
  }

  function onArchive(a: AccountCard) {
    startTransition(async () => {
      try {
        await setAccountArchived(a.id, !a.archived)
        toast.success(a.archived ? t("{name} restored", { name: a.name }) : t("{name} archived", { name: a.name }))
      } catch {
        toast.error(t("Could not update account"))
      }
    })
  }

  function onSync(a: AccountCard) {
    startTransition(async () => {
      try {
        const result = await syncRithmicAccount(a.id)
        toast.success(result.imported > 0 ? (result.imported === 1 ? t("Synced — 1 new trade") : t("Synced — {n} new trades", { n: result.imported })) : t("Already up to date"))
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Sync failed"))
      }
    })
  }

  function onEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editing) return
    const fd = new FormData(e.currentTarget)
    const id = editing.account.id
    startTransition(async () => {
      try {
        if (editing.mode === "balance") {
          await updateAccount(id, { startingBalance: Number(fd.get("startingBalance")), currency: String(fd.get("currency") ?? "") })
        } else {
          await updateAccount(id, { name: String(fd.get("name") ?? ""), broker: String(fd.get("broker") ?? "") })
        }
        toast.success(t("Account updated"))
        setEditing(null)
      } catch {
        toast.error(t("Could not update account"))
      }
    })
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{t("Accounts")}</h2>
            <a
              href="/add-trade"
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {t("Learn more")} <ExternalLink className="size-3.5" />
            </a>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isPro ? t("Unlimited active accounts included in your plan.") : t("You can have up to 1 active account on your plan.")}
          </p>
        </div>
        <Dialog open={open} onOpenChange={openAddDialog}>
          <DialogTrigger render={<Button size="lg" className="px-5 font-semibold"><Plus className="size-4" /> {t("Add account")}</Button>} />
          <DialogContent className={addMode === "auto" ? "sm:max-w-3xl" : undefined}>
            {addMode === "choice" && (
              <>
                <DialogHeader>
                  <DialogTitle>{t("Add a trading account")}</DialogTitle>
                  <DialogDescription>{t("How do you want to add trades to this account?")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAddMode("auto")}
                    className="flex flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors hover:border-primary hover:bg-accent/40"
                  >
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Zap className="size-5" />
                    </span>
                    <span className="font-semibold">{t("Auto Sync")}</span>
                    <span className="text-sm text-muted-foreground">{t("Connect your prop firm — every trade imports automatically.")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode("manual")}
                    className="flex flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors hover:border-primary hover:bg-accent/40"
                  >
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                      <PenLine className="size-5" />
                    </span>
                    <span className="font-semibold">{t("Manual")}</span>
                    <span className="text-sm text-muted-foreground">{t("Create the account and log trades yourself (or import a file).")}</span>
                  </button>
                </div>
              </>
            )}

            {addMode === "manual" && (
              <>
                <DialogHeader>
                  <button type="button" onClick={() => setAddMode("choice")} className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="size-4" /> {t("Back")}
                  </button>
                  <DialogTitle>{t("Add a trading account")}</DialogTitle>
                  <DialogDescription>{t("Give it a name you'll recognize when logging trades.")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">{t("Name")}</Label>
                    <Input id="name" name="name" placeholder={t("Apex 50K, Main Tradovate, IBKR…")} required />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="broker">{t("Broker / prop firm")}</Label>
                    <Input id="broker" name="broker" placeholder={t("Tradovate, NinjaTrader, Apex, TopStep…")} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="startingBalance">{t("Starting balance")}</Label>
                      <Input id="startingBalance" name="startingBalance" type="number" step="0.01" defaultValue="0" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="currency">{t("Currency")}</Label>
                      <Input id="currency" name="currency" defaultValue="USD" maxLength={3} className="uppercase" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={pending} className="w-full">
                      {pending ? t("Adding…") : t("Add account")}
                    </Button>
                  </DialogFooter>
                </form>
              </>
            )}

            {addMode === "auto" && (
              <>
                <DialogHeader>
                  <button type="button" onClick={() => setAddMode("choice")} className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="size-4" /> {t("Back")}
                  </button>
                  <DialogTitle>{t("Connect Rithmic")}</DialogTitle>
                  <DialogDescription>{t("Use your Rithmic trading login. Every account found under it is added and synced.")}</DialogDescription>
                </DialogHeader>
                <ConnectForm onDone={() => setOpen(false)} />
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {accounts.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
          <Wallet className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("No accounts yet — add one, or import trades to create it automatically.")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="py-3">{t("Account name")}</TableHead>
                <TableHead className="py-3">{t("Broker")}</TableHead>
                <TableHead className="py-3">{t("Type")}</TableHead>
                <TableHead className="py-3">{t("Status")}</TableHead>
                <TableHead className="py-3 text-end">{t("Balance")}</TableHead>
                <TableHead className="py-3">{t("P&L method")}</TableHead>
                <TableHead className="py-3">{t("Last update")}</TableHead>
                <TableHead className="py-3">{t("Next update")}</TableHead>
                <TableHead className="w-10 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const balance = a.currentBalance != null ? Number(a.currentBalance) : Number(a.startingBalance)
                return (
                  <TableRow key={a.id} className={cn(a.archived && "opacity-55")}>
                    <TableCell className="py-3.5 font-medium">
                      <span className="flex items-center gap-2">
                        <Link href={`/accounts/${a.id}`} className="hover:underline">{a.name}</Link>
                        {a.archived && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("Archived")}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5">
                      {a.broker ? (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          {brokerLogo(a.broker) ? (
                            <Image src={brokerLogo(a.broker) as string} alt="" width={20} height={20} className="size-5 shrink-0 rounded object-cover" />
                          ) : (
                            <span
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                                brokerChipColor(a.broker),
                              )}
                            >
                              {a.broker.charAt(0).toUpperCase()}
                            </span>
                          )}
                          {a.broker}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-muted-foreground">{a.isLiveSynced ? t("Live Sync") : t("File Upload")}</TableCell>
                    <TableCell className="py-3.5">
                      {!a.isLiveSynced ? (
                        <a href="/add-trade" className="text-sm font-medium text-primary hover:underline">
                          {t("Add Trades")}
                        </a>
                      ) : a.lastSyncStatus === "error" ? (
                        <span className="text-sm text-[var(--loss)]">{t("Sync error")}</span>
                      ) : a.lastSyncedAt ? (
                        <span className="text-sm text-[var(--gain)]">{t("Synced")}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t("Pending first sync")}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-end font-medium tabular-nums">
                      {formatCurrency(balance, a.currency)}
                    </TableCell>
                    <TableCell className="py-3.5 text-muted-foreground">{t("Avg Cost")}</TableCell>
                    <TableCell className="py-3.5 whitespace-nowrap text-muted-foreground">
                      {a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString(dateLocale) : "—"}
                    </TableCell>
                    <TableCell className="py-3.5 whitespace-nowrap text-muted-foreground">
                      {a.isLiveSynced && a.lastSyncStatus !== "error" ? t("~1 min") : "—"}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="size-8" aria-label={t("Actions for {name}", { name: a.name })}>
                              <MoreVertical className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setEditing({ account: a, mode: "edit" })}>
                            <Pencil className="size-4" /> {t("Edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem render={<Link href="/add-trade" />}>
                            <Upload className="size-4" /> {t("File Upload")}
                          </DropdownMenuItem>
                          <DropdownMenuItem render={<Link href="/add-trade" />}>
                            <PenLine className="size-4" /> {t("Manual Upload")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditing({ account: a, mode: "balance" })}>
                            <SlidersHorizontal className="size-4" /> {t("Edit Balance")}
                          </DropdownMenuItem>
                          {a.canSync && (
                            <DropdownMenuItem onClick={() => onSync(a)} disabled={pending}>
                              <RefreshCw className="size-4" /> {t("Auto Sync")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onArchive(a)} disabled={pending}>
                            {a.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                            {a.archived ? t("Restore Account") : t("Archive Account")}
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => onDelete(a.id, a.name)} disabled={pending}>
                            <Trash2 className="size-4" /> {t("Delete Account")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.mode === "balance" ? t("Edit balance") : t("Edit account")}</DialogTitle>
                <DialogDescription>
                  {editing.mode === "balance"
                    ? t("Set the account's starting balance — your equity and drawdown are measured from it.")
                    : t("Rename the account or change its broker label.")}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onEditSubmit} className="space-y-4">
                {editing.mode === "balance" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-balance">{t("Starting balance")}</Label>
                      <Input id="edit-balance" name="startingBalance" type="number" step="0.01" defaultValue={editing.account.startingBalance} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-currency">{t("Currency")}</Label>
                      <Input id="edit-currency" name="currency" defaultValue={editing.account.currency} maxLength={3} className="uppercase" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-name">{t("Name")}</Label>
                      <Input id="edit-name" name="name" defaultValue={editing.account.name} required />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-broker">{t("Broker / prop firm")}</Label>
                      <Input id="edit-broker" name="broker" defaultValue={editing.account.broker ?? ""} placeholder={t("Tradovate, NinjaTrader, Apex, TopStep…")} />
                    </div>
                  </>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={pending} className="w-full">
                    {pending ? t("Saving…") : t("Save")}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
