"use client"

import type React from "react"
import { useState, useTransition } from "react"
import { shareWithUser, removePlaybookShare, sharePlaybook, unsharePlaybook } from "@/app/actions/playbooks"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { X, Link2, Copy, Users } from "lucide-react"
import { toast } from "sonner"

export interface SharedPerson {
  userId: string
  name: string
  email: string
  image: string | null
}

export function SharePlaybookDialog({
  open,
  onOpenChange,
  playbookId,
  playbookName,
  shareToken,
  sharedWith,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  playbookId: number
  playbookName: string
  shareToken: string | null
  sharedWith: SharedPerson[]
}) {
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState("")
  // Local overrides so the dialog feels immediate without waiting on revalidatePath.
  const [tokenOverride, setTokenOverride] = useState<string | null | undefined>(undefined)
  const [peopleOverride, setPeopleOverride] = useState<SharedPerson[] | undefined>(undefined)

  const token = tokenOverride !== undefined ? tokenOverride : shareToken
  const people = peopleOverride ?? sharedWith

  function onToggleLink() {
    startTransition(async () => {
      try {
        if (token) {
          await unsharePlaybook(playbookId)
          setTokenOverride(null)
          toast.success("Link sharing turned off")
        } else {
          const newToken = await sharePlaybook(playbookId)
          setTokenOverride(newToken)
          toast.success("Link created")
        }
      } catch {
        toast.error("Could not update link sharing")
      }
    })
  }

  function onCopyLink() {
    if (!token) return
    navigator.clipboard.writeText(`${window.location.origin}/p/${token}`).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy — copy it manually"),
    )
  }

  function onShareWithPerson(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    startTransition(async () => {
      try {
        const person = await shareWithUser(playbookId, trimmed)
        setPeopleOverride([...people, { userId: person.id, name: person.name, email: person.email, image: person.image }])
        setEmail("")
        toast.success(`Shared with ${person.name}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not share")
      }
    })
  }

  function onRemovePerson(userId: string) {
    startTransition(async () => {
      try {
        await removePlaybookShare(playbookId, userId)
        setPeopleOverride(people.filter((p) => p.userId !== userId))
      } catch {
        toast.error("Could not remove")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share "{playbookName}"</DialogTitle>
          <DialogDescription>Share the strategy — never your trades or P&L.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" /> Share with a TradeLoop user
            </Label>
            <form onSubmit={onShareWithPerson} className="flex gap-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="their@email.com"
                className="flex-1"
              />
              <Button type="submit" disabled={pending || !email.trim()}>
                Share
              </Button>
            </form>
            {people.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {people.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                    <Avatar size="sm">
                      {p.image && <AvatarImage src={p.image} alt="" />}
                      <AvatarFallback>{p.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground"
                      onClick={() => onRemovePerson(p.userId)}
                      disabled={pending}
                      aria-label={`Stop sharing with ${p.name}`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t pt-4">
            <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="size-3.5" /> Public link
            </Label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onToggleLink} disabled={pending} className="flex-1">
                {token ? "Turn off link" : "Create link"}
              </Button>
              {token && (
                <Button variant="outline" size="icon" onClick={onCopyLink} aria-label="Copy link">
                  <Copy className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
