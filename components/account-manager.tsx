"use client"

import type React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { createAccount, deleteAccount } from "@/app/actions/accounts"
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
import { Plus, Trash2, Wallet, MoreVertical, ExternalLink } from "lucide-react"
import { toast } from "sonner"

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
  lastSyncedAt: Date | null
  lastSyncStatus: string | null
}

export function AccountManager({ accounts, isPro }: { accounts: AccountCard[]; isPro: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await createAccount(formData)
        toast.success("Account added")
        setOpen(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not add account")
      }
    })
  }

  function onDelete(id: number, name: string) {
    startTransition(async () => {
      try {
        await deleteAccount(id)
        toast.success(`Removed ${name}`)
      } catch {
        toast.error("Could not remove account")
      }
    })
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">Accounts</h2>
            <a
              href="/add-trade"
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Learn more <ExternalLink className="size-3.5" />
            </a>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isPro ? "Unlimited active accounts included in your plan." : "You can have up to 1 active account on your plan."}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="lg" className="px-5 font-semibold"><Plus className="size-4" /> Add account</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a trading account</DialogTitle>
              <DialogDescription>Give it a name you'll recognize when logging trades.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Apex 50K, Main Tradovate, IBKR…" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="broker">Broker / prop firm</Label>
                <Input id="broker" name="broker" placeholder="Tradovate, NinjaTrader, Apex, TopStep…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="startingBalance">Starting balance</Label>
                  <Input id="startingBalance" name="startingBalance" type="number" step="0.01" defaultValue="0" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input id="currency" name="currency" defaultValue="USD" maxLength={3} className="uppercase" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Adding…" : "Add account"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {accounts.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
          <Wallet className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No accounts yet — add one, or import trades to create it automatically.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="py-3">Account name</TableHead>
                <TableHead className="py-3">Broker</TableHead>
                <TableHead className="py-3">Type</TableHead>
                <TableHead className="py-3">Status</TableHead>
                <TableHead className="py-3 text-right">Balance</TableHead>
                <TableHead className="py-3">P&amp;L method</TableHead>
                <TableHead className="py-3">Last update</TableHead>
                <TableHead className="py-3">Next update</TableHead>
                <TableHead className="w-10 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const balance = a.currentBalance != null ? Number(a.currentBalance) : Number(a.startingBalance)
                return (
                  <TableRow key={a.id}>
                    <TableCell className="py-3.5 font-medium">
                      <Link href={`/accounts/${a.id}`} className="hover:underline">{a.name}</Link>
                    </TableCell>
                    <TableCell className="py-3.5">
                      {a.broker ? (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                              brokerChipColor(a.broker),
                            )}
                          >
                            {a.broker.charAt(0).toUpperCase()}
                          </span>
                          {a.broker}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-muted-foreground">{a.isLiveSynced ? "Live Sync" : "File Upload"}</TableCell>
                    <TableCell className="py-3.5">
                      {!a.isLiveSynced ? (
                        <a href="/add-trade" className="text-sm font-medium text-primary hover:underline">
                          Add Trades
                        </a>
                      ) : a.lastSyncStatus === "error" ? (
                        <span className="text-sm text-[var(--loss)]">Sync error</span>
                      ) : a.lastSyncedAt ? (
                        <span className="text-sm text-[var(--gain)]">Synced</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Pending first sync</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-right font-medium tabular-nums">
                      {formatCurrency(balance, a.currency)}
                    </TableCell>
                    <TableCell className="py-3.5 text-muted-foreground">Avg Cost</TableCell>
                    <TableCell className="py-3.5 whitespace-nowrap text-muted-foreground">
                      {a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="py-3.5 whitespace-nowrap text-muted-foreground">
                      {a.isLiveSynced && a.lastSyncStatus !== "error" ? "~1 min" : "—"}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${a.name}`}>
                              <MoreVertical className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem variant="destructive" onClick={() => onDelete(a.id, a.name)} disabled={pending}>
                            <Trash2 className="size-4" />
                            Delete account
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
    </Card>
  )
}
