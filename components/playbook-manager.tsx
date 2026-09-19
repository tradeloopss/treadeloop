"use client"

import type React from "react"
import { useMemo, useState, useTransition } from "react"
import { createPlaybook, deletePlaybook, cloneSharedPlaybook, removePlaybookShare } from "@/app/actions/playbooks"
import { formatCurrency } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { SharePlaybookDialog, type SharedPerson } from "@/components/share-playbook-dialog"
import { Plus, MoreHorizontal, Search, CheckCircle2, Copy } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/components/locale-provider"

export interface PlaybookCard {
  id: number
  name: string
  description: string | null
  rules: string[] | null
  trades: number
  netPnl: number
  winRate: number
  shareToken: string | null
  sharedWith: SharedPerson[]
}

export interface SharedPlaybookCard {
  id: number
  name: string
  description: string | null
  rules: string[] | null
  trades: number
  netPnl: number
  winRate: number
  ownerId: string
  ownerName: string
}

export function PlaybookManager({
  playbooks,
  sharedWithMe,
}: {
  playbooks: PlaybookCard[]
  sharedWithMe: SharedPlaybookCard[]
}) {
  const t = useT()
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [query, setQuery] = useState("")
  const [shareTarget, setShareTarget] = useState<PlaybookCard | null>(null)

  const filteredMine = useMemo(
    () => playbooks.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [playbooks, query],
  )
  const filteredShared = useMemo(
    () => sharedWithMe.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [sharedWithMe, query],
  )

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await createPlaybook(formData)
        toast.success(t("Playbook created"))
        setCreateOpen(false)
      } catch {
        toast.error(t("Could not create playbook"))
      }
    })
  }

  function onDelete(id: number) {
    startTransition(async () => {
      try {
        await deletePlaybook(id)
        toast.success(t("Playbook deleted"))
      } catch {
        toast.error(t("Could not delete playbook"))
      }
    })
  }

  function onSaveCopy(id: number) {
    startTransition(async () => {
      try {
        await cloneSharedPlaybook(id)
        toast.success(t("Added to your playbooks"))
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Could not save a copy"))
      }
    })
  }

  function onRemoveShared(playbookId: number, ownerUserId: string) {
    startTransition(async () => {
      try {
        await removePlaybookShare(playbookId, ownerUserId)
        toast.success(t("Removed from your shared playbooks"))
      } catch {
        toast.error(t("Could not remove"))
      }
    })
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="mine">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="mine">{t("My Playbook")}</TabsTrigger>
            <TabsTrigger value="shared">{t("Shared Playbook")}</TabsTrigger>
          </TabsList>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search playbooks…")}
                className="w-full ps-8 sm:w-48"
              />
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger render={<Button className="shrink-0"><Plus className="size-4" /> {t("Create Playbook")}</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("Create a playbook")}</DialogTitle>
                  <DialogDescription>{t("Define a repeatable setup and the rules that make it valid.")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="name">{t("Name")}</Label>
                    <Input id="name" name="name" placeholder={t("Opening range breakout")} required />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="description">{t("Description")}</Label>
                    <Input id="description" name="description" placeholder={t("Short thesis for this setup")} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="rules">{t("Rules (one per line)")}</Label>
                    <Textarea
                      id="rules"
                      name="rules"
                      rows={5}
                      placeholder={t("Wait for 5m opening range\nEnter on retest of breakout\nStop below range low\nTarget 2R minimum")}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={pending} className="w-full">
                      {pending ? t("Creating…") : t("Create playbook")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <TabsContent value="mine" className="mt-4">
          {filteredMine.length === 0 ? (
            <Card className="flex h-48 flex-col items-center justify-center gap-2 text-center">
              <CheckCircle2 className="size-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {playbooks.length === 0 ? t("No playbooks yet. Create one to grade your setups against your rules.") : t("No playbooks match your search.")}
              </p>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Playbook Name")}</TableHead>
                    <TableHead className="text-end">{t("Trades")}</TableHead>
                    <TableHead className="text-end">{t("Win Rate")}</TableHead>
                    <TableHead className="text-end">{t("Net P&L")}</TableHead>
                    <TableHead>{t("Shared Playbooks")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMine.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium">{p.name}</p>
                        {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{p.trades}</TableCell>
                      <TableCell className="text-end tabular-nums">{p.winRate.toFixed(0)}%</TableCell>
                      <TableCell
                        className={cn(
                          "text-end font-medium tabular-nums",
                          p.netPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
                        )}
                      >
                        {p.netPnl >= 0 ? "+" : ""}
                        {formatCurrency(p.netPnl)}
                      </TableCell>
                      <TableCell>
                        {p.sharedWith.length > 0 ? (
                          <div className="flex -space-x-2">
                            {p.sharedWith.slice(0, 3).map((s) => (
                              <Avatar key={s.userId} size="sm" className="ring-2 ring-background">
                                {s.image && <AvatarImage src={s.image} alt="" />}
                                <AvatarFallback>{s.name.charAt(0).toUpperCase()}</AvatarFallback>
                              </Avatar>
                            ))}
                            {p.sharedWith.length > 3 && (
                              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
                                +{p.sharedWith.length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="size-8" aria-label={t("{name} options", { name: p.name })}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setShareTarget(p)}>{t("Share")}</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => onDelete(p.id)}>
                              {t("Delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="shared" className="mt-4">
          {filteredShared.length === 0 ? (
            <Card className="flex h-48 flex-col items-center justify-center gap-2 text-center">
              <CheckCircle2 className="size-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {sharedWithMe.length === 0 ? t("No one has shared a playbook with you yet.") : t("No shared playbooks match your search.")}
              </p>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Playbook Name")}</TableHead>
                    <TableHead>{t("Shared By")}</TableHead>
                    <TableHead className="text-end">{t("Trades")}</TableHead>
                    <TableHead className="text-end">{t("Win Rate")}</TableHead>
                    <TableHead className="text-end">{t("Net P&L")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredShared.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium">{p.name}</p>
                        {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.ownerName}</TableCell>
                      <TableCell className="text-end tabular-nums">{p.trades}</TableCell>
                      <TableCell className="text-end tabular-nums">{p.winRate.toFixed(0)}%</TableCell>
                      <TableCell
                        className={cn(
                          "text-end font-medium tabular-nums",
                          p.netPnl >= 0 ? "text-[var(--gain)]" : "text-[var(--loss)]",
                        )}
                      >
                        {p.netPnl >= 0 ? "+" : ""}
                        {formatCurrency(p.netPnl)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="size-8" aria-label={t("{name} options", { name: p.name })}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onSaveCopy(p.id)}>
                              <Copy className="size-4" /> {t("Save a copy")}
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => onRemoveShared(p.id, p.ownerId)}>
                              {t("Remove")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {shareTarget && (
        <SharePlaybookDialog
          open={!!shareTarget}
          onOpenChange={(open) => !open && setShareTarget(null)}
          playbookId={shareTarget.id}
          playbookName={shareTarget.name}
          shareToken={shareTarget.shareToken}
          sharedWith={shareTarget.sharedWith}
        />
      )}
    </div>
  )
}
