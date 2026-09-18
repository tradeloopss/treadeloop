"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ManualTradeForm } from "@/components/manual-trade-form"
import { Plus } from "lucide-react"

export function AddTradeDialog({ accounts, playbooks }: { accounts: { id: number; name: string }[]; playbooks: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Log trade
          </Button>
        }
      />
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log a trade</DialogTitle>
          <DialogDescription>Record an entry. P&L and R-multiple are calculated automatically.</DialogDescription>
        </DialogHeader>
        <ManualTradeForm accounts={accounts} playbooks={playbooks} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
