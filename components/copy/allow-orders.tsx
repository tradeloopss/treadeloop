"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react"
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
// Then it is put to the broker, and the window stays open for the answer: the
// sync server logs in with the password once and says whether the broker lets
// it trade, turned it down, or lets it only read. A password taken on trust
// was found out at the first trade that was not copied.
//
// It says what is true: the password is kept encrypted, and the same switch
// turns on orders from the Trade Manager.

// how long the window waits for the broker's answer before it lets the trader go; the account shows it when it comes
const WAIT_MS = 60_000
const POLL_MS = 2_500

export function AllowOrdersDialog({ account, onClose, onDone }: { account: AccountView | null; onClose: () => void; onDone: () => Promise<void> | void }) {
  const { pending, run } = useAction()
  const [how, setHow] = useState<"login" | "typed">(account?.ordersCheck === "read_only" || account?.ordersCheck === "rejected" ? "typed" : "login")
  const [password, setPassword] = useState("")
  // saved here, and waiting for what the broker says of it
  const [asked, setAsked] = useState<number | null>(null)
  const [waited, setWaited] = useState(false)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  const saved = !!account?.ordersAllowed
  const check = account?.ordersCheck ?? null
  const waiting = asked != null && check === "pending" && !waited
  const close = () => {
    setPassword("")
    setAsked(null)
    onClose()
  }

  // while the broker is being asked: look again every few seconds, for a minute
  useEffect(() => {
    if (!waiting || asked == null) return
    const poll = setInterval(() => void done.current(), POLL_MS)
    const stop = setTimeout(() => setWaited(true), Math.max(0, asked + WAIT_MS - Date.now()))
    return () => {
      clearInterval(poll)
      clearTimeout(stop)
    }
  }, [waiting, asked])

  // The answer, when it was this window that asked: a yes closes it, and a no
  // stays on the screen with the field for the master password open.
  const name = account?.name ?? ""
  useEffect(() => {
    if (asked == null || check == null || check === "pending") return
    setAsked(null)
    if (check !== "ok") return setHow("typed")
    toast.success(`Orders allowed on ${name}.`, { description: "The broker confirmed this password can trade. Use Retry on a trade that wasn't sent, or wait for the Leader's next one." })
    onClose()
  }, [asked, check, name, onClose])

  const problem = saved && (check === "rejected" || check === "read_only") ? check : null
  const choices = [
    { key: "login" as const, label: "I connected it with the master password", hint: "Use the password this account is connected with now. Nothing to type." },
    { key: "typed" as const, label: saved ? "Enter the master password" : "I connected it with the investor password", hint: "Enter the account's master (trading) password here." },
  ]
  const save = () =>
    account &&
    run(
      () => allowCopyOrders(account.id, how === "login" ? { use: "login" } : { use: "typed", password }),
      async () => {
        setWaited(false)
        setAsked(Date.now())
        setPassword("")
        await onDone()
      },
    )
  return (
    <Dialog open={!!account} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{saved ? `Orders on ${name}` : `Allow orders on ${name}`}</DialogTitle>
          <DialogDescription render={<div />} className="space-y-2 text-sm text-muted-foreground">
            <p>
              Copying a trade into this account means placing an order on it. That takes the account&apos;s <span className="font-semibold text-foreground">master (trading) password</span>: an investor password can read an account and can&apos;t trade on it.
            </p>
          </DialogDescription>
        </DialogHeader>

        {waiting ? (
          <div role="status" className="flex items-start gap-3 rounded-xl border p-3 text-sm">
            <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
            <div>
              <p className="font-medium">Checking the password with the broker…</p>
              <p className="text-xs text-muted-foreground">Our sync server is logging in to {account?.login ?? "the account"} with it once. This usually takes under half a minute.</p>
            </div>
          </div>
        ) : (
          <>
            {problem && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-[var(--loss)]/50 bg-[var(--loss)]/10 p-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--loss)]" aria-hidden />
                <div>
                  <p className="font-medium">{problem === "rejected" ? `The broker rejected that password for account ${account?.login ?? ""}.` : "That password logs in, but the broker won't let it trade."}</p>
                  <p className="text-xs text-muted-foreground">
                    {problem === "rejected"
                      ? "No orders are sent with it. Check the password (it is case-sensitive) and enter the master password again."
                      : "It is the investor (read-only) password, or the broker has trading switched off for the account. No orders are sent with it. Enter the master password."}
                  </p>
                </div>
              </div>
            )}
            {saved && !problem && (
              <div className="flex items-start gap-3 rounded-xl border p-3 text-sm">
                <CircleCheck className={cn("mt-0.5 size-4 shrink-0", check === "ok" ? "text-[var(--gain)]" : "text-muted-foreground")} aria-hidden />
                <p>
                  {check === "ok"
                    ? "Orders are allowed, and the broker confirmed the saved password can trade."
                    : check === "pending"
                      ? asked != null
                        ? "Saved. The broker hasn't answered yet: the account shows the result as soon as it does, and you can close this window."
                        : "Orders are allowed. The saved password is being checked with the broker."
                      : "Orders are allowed. The saved password hasn't been checked with the broker: the first order shows whether it can trade."}
                </p>
              </div>
            )}
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
              <li>When you save it, the sync server logs in with it once to ask the broker whether it can trade, and tells you here.</li>
              <li>You can turn orders off again here at any time.</li>
            </ul>
          </>
        )}

        <DialogFooter>
          {saved && account && !waiting && (
            <button
              type="button"
              disabled={pending}
              className={cn(linkBtn, "text-[var(--loss)] sm:me-auto")}
              onClick={() =>
                run(
                  () => stopCopyOrders(account.id),
                  async () => {
                    toast.success(`Orders turned off on ${account.name}.`)
                    close()
                    await onDone()
                  },
                )
              }
            >
              Turn off orders
            </button>
          )}
          <button type="button" className={linkBtn} onClick={close}>
            {waiting ? "Close" : "Cancel"}
          </button>
          {!waiting && (
            <button type="button" disabled={pending || !account || (how === "typed" && !password.trim())} className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50" onClick={save}>
              {pending ? "Saving…" : saved ? "Save and check" : "Allow orders"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
