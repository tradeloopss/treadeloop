"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setActiveAccounts } from "@/app/actions/accounts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Wallet } from "lucide-react"

export function AccountCustomizer({
  accounts,
  activeAccountIds,
}: {
  accounts: { id: number; name: string }[]
  activeAccountIds: number[] | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  // Local draft so checking boxes doesn't hit the server on every click —
  // only commits (and refreshes data) once the popover closes.
  const [draft, setDraft] = useState<number[] | null>(activeAccountIds)

  useEffect(() => {
    if (open) setDraft(activeAccountIds)
  }, [open, activeAccountIds])

  const allSelected = draft == null
  const label = allSelected
    ? "All accounts"
    : draft.length === 1
      ? (accounts.find((a) => a.id === draft[0])?.name ?? "1 account")
      : `${draft.length} accounts`

  function toggleAll() {
    setDraft(null)
  }

  function toggleAccount(id: number) {
    // Selecting an account is exclusive — it replaces whatever was picked
    // before (including "All accounts", where every row renders checked).
    // Clicking the currently-sole-selected account again falls back to "All".
    setDraft((prev) => (prev != null && prev.length === 1 && prev[0] === id ? null : [id]))
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      startTransition(async () => {
        await setActiveAccounts(draft)
        router.refresh()
      })
    }
  }

  if (accounts.length === 0) return null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="outline" disabled={pending}>
            <Wallet className="size-4" />
            {label}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64 p-1">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
          All accounts
        </label>
        <div className="my-1 border-t" />
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">My accounts</p>
        {accounts.map((a) => {
          const checked = allSelected || (draft?.includes(a.id) ?? false)
          return (
            <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox checked={checked} onCheckedChange={() => toggleAccount(a.id)} />
              <span className="truncate">{a.name}</span>
            </label>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
