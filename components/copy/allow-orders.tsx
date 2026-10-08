"use client"

import { useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { allowCopyOrders, stopCopyOrders } from "@/app/actions/copy-trading"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { AccountView } from "@/lib/copy/view"
import { useAction } from "@/components/insights/client"
import { fieldClass, linkBtn } from "@/components/insights/ui"

// Allow orders on a follower, without leaving Copy Trading.
//
// Copying a trade into an account means placing an order on it, and a
// MetaTrader account takes one only from its master password. TradeLoop can't
// tell which password an account was connected with, so it asks: use that one,
// or type the master password here. Either is the trader's own choice for this
// one account, and it is undone in the same place.
//
// It says what is true: the password is kept encrypted, the same switch turns
// on orders from the Trade Manager, and whether a password can trade is the
// broker's answer to the first order, not ours.
export function AllowOrdersDialog({ account, onClose, onDone }: { account: AccountView | null; onClose: () => void; onDone: () => Promise<void> | void }) {
  const { pending, run } = useAction()
  const [how, setHow] = useState<"login" | "typed">("login")
  const [password, setPassword] = useState("")
  const on = !!account?.canExecute
  const close = () => {
    setPassword("")
    setHow("login")
    onClose()
  }
  const finish = async (message: string, description?: string) => {
    toast.success(message, { description })
    close()
    await onDone()
  }
  const choices = [
    { key: "login" as const, label: "I connected it with the master password", hint: "Use the password this account is already connected with. Nothing to type." },
    { key: "typed" as const, label: on ? "Enter a different master password" : "I connected it with the investor password", hint: "Enter the account's master (trading) password here." },
  ]
  return (
    <Dialog open={!!account} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{on ? `Orders on ${account?.name ?? ""}` : `Allow orders on ${account?.name ?? ""}`}</DialogTitle>
          <DialogDescription render={<div />} className="space-y-2 text-sm text-muted-foreground">
            <p>
              Copying a trade into this account means placing an order on it. That takes the account&apos;s <span className="font-semibold text-foreground">master (trading) password</span>: an investor password can read an account and can&apos;t trade on it.
            </p>
            {on && <p>Orders are allowed on this account now. Save a different password, or turn them off.</p>}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="sr-only">Which password places the orders</legend>
          {choices.map((c) => (
            <label key={c.key} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", how === c.key && "border-primary bg-primary/5")}>
              <input type="radio" name="allow-orders-how" className="mt-0.5 size-4 accent-[var(--primary)]" checked={how === c.key} onChange={() => setHow(c.key)} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.hint}</span>
                {c.key === "typed" && how === "typed" && <input type="password" className={cn(fieldClass, "mt-2")} value={password} autoComplete="off" autoFocus spellCheck={false} placeholder="Master (trading) password" aria-label="Master (trading) password" onChange={(e) => setPassword(e.target.value)} />}
              </span>
            </label>
          ))}
        </fieldset>
        <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
          <li>The password is kept encrypted and used only by our sync server, to place orders on this account: the copies your groups send, and the orders you send from the Trade Manager.</li>
          <li>Whether a password can trade is the broker&apos;s answer. If this one turns out to be the investor password, the first order is refused (“Trade disabled”) and shows under Alerts: come back and enter the master password.</li>
          <li>You can turn orders off again here at any time.</li>
        </ul>
        <DialogFooter>
          {on && account && (
            <button type="button" disabled={pending} className={cn(linkBtn, "text-[var(--loss)] sm:me-auto")} onClick={() => run(() => stopCopyOrders(account.id), () => finish(`Orders turned off on ${account.name}.`))}>
              Turn off orders
            </button>
          )}
          <button type="button" className={linkBtn} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !account || (how === "typed" && !password.trim())}
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => account && run(() => allowCopyOrders(account.id, how === "login" ? { use: "login" } : { use: "typed", password }), () => finish(`Orders allowed on ${account.name}.`, "Use Retry on a trade that wasn't sent, or wait for the Leader's next one."))}
          >
            {pending ? "Saving…" : on ? "Save" : "Allow orders"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
