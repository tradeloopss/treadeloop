"use client"

import { useTransition } from "react"
import { deletePropFirmTransaction, type PropFirmAccount, type PropFirmTransaction } from "@/app/actions/propfirm"
import { formatCurrency } from "@/lib/calc"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

const CATEGORY_LABELS: Record<string, string> = {
  evaluation_fee: "Evaluation fee",
  reset_fee: "Reset fee",
  activation_fee: "Activation fee",
  other: "Other",
}

function Row({ tx, accountName, currency }: { tx: PropFirmTransaction; accountName: string; currency: string }) {
  const [pending, startTransition] = useTransition()

  function onDelete() {
    startTransition(async () => {
      try {
        await deletePropFirmTransaction(tx.id)
        toast.success("Removed")
      } catch {
        toast.error("Could not remove entry")
      }
    })
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(tx.occurredAt).toLocaleDateString()}</TableCell>
      <TableCell className="font-medium">{accountName}</TableCell>
      <TableCell>
        <span className={cn("capitalize", tx.type === "payout" ? "text-[var(--gain)]" : "text-muted-foreground")}>
          {tx.type === "payout" ? "Payout" : CATEGORY_LABELS[tx.category ?? "other"] ?? "Cost"}
        </span>
      </TableCell>
      <TableCell className="max-w-[220px] truncate text-muted-foreground">{tx.note ?? "—"}</TableCell>
      <TableCell className={cn("text-right font-medium tabular-nums", tx.type === "payout" ? "text-[var(--gain)]" : "text-[var(--loss)]")}>
        {tx.type === "payout" ? "+" : "-"}
        {formatCurrency(tx.amount, currency)}
      </TableCell>
      <TableCell className="w-8">
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={onDelete} disabled={pending} aria-label="Delete entry">
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function PropFirmTransactions({
  transactions,
  accounts,
  currency,
}: {
  transactions: PropFirmTransaction[]
  accounts: PropFirmAccount[]
  currency: string
}) {
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))

  if (transactions.length === 0) {
    return (
      <Card className="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">No fees or payouts logged yet — log one from an account in the Accounts tab.</p>
      </Card>
    )
  }

  return (
    <Card className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx) => (
            <Row key={tx.id} tx={tx} accountName={accountNameById.get(tx.accountId) ?? "Unknown account"} currency={currency} />
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
