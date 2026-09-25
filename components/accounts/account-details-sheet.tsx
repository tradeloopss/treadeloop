"use client"

import type React from "react"
import { useRef } from "react"
import Link from "next/link"
import { ArrowLeft, KeyRound, LayoutDashboard, PenLine, Plus, RefreshCw, Trash2, Unplug, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useT } from "@/components/locale-provider"
import { AccountAvatar, AccountMenu, HealthPill, type AccountActions } from "@/components/accounts/account-ui"
import { messageTone, useRowMetrics, useSyncWords, type RowModel } from "@/components/accounts/account-rows"

// Phones: tapping an account opens its details as a screen of their own
// (← Accounts, +) instead of expanding the row — identity and status, what
// the platform reports (balance, equity, open positions…), the last sync with
// "Sync now", then every action as a full-width row. The list's own dialogs
// (rename, confirm) come in as `children` so they open nested in this one.
export function AccountDetailsSheet({
  row,
  syncing,
  actions,
  onClose,
  onAddAccount,
  children,
}: {
  row: RowModel | null
  syncing?: boolean
  actions: AccountActions
  onClose: () => void
  onAddAccount: () => void
  children?: React.ReactNode
}) {
  // Keep showing the last account while the screen animates out.
  const last = useRef(row)
  if (row) last.current = row
  const shown = row ?? last.current

  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        {shown && <Details row={shown} syncing={syncing} actions={actions} onClose={onClose} onAddAccount={onAddAccount} />}
        {children}
      </DialogContent>
    </Dialog>
  )
}

interface Item {
  key: string
  icon: LucideIcon
  label: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  destructive?: boolean
}

function Details({
  row,
  syncing,
  actions,
  onClose,
  onAddAccount,
}: {
  row: RowModel
  syncing?: boolean
  actions: AccountActions
  onClose: () => void
  onAddAccount: () => void
}) {
  const t = useT()
  const metrics = useRowMetrics(row)
  const { lastSyncedLine } = useSyncWords(row, syncing)
  const c = row.connection
  const a = row.account
  const status = syncing ? "syncing" : row.status

  // Reconnecting opens the connect window on the page underneath, so leave
  // this screen first.
  const sheetActions: AccountActions = {
    ...actions,
    onReconnect: actions.onReconnect
      ? () => {
          onClose()
          actions.onReconnect!()
        }
      : undefined,
  }

  const items: Item[] = []
  if (a) items.push({ key: "view", icon: LayoutDashboard, label: t("View details"), href: `/accounts/${a.id}` })
  if (a && actions.onEdit) items.push({ key: "rename", icon: PenLine, label: t("Rename account"), onClick: () => actions.onEdit!(a, "edit") })
  if (actions.onSync) items.push({ key: "sync", icon: RefreshCw, label: syncing ? t("Syncing…") : t("Sync now"), onClick: actions.onSync, disabled: syncing })
  if (sheetActions.onReconnect) items.push({ key: "reconnect", icon: KeyRound, label: t("Reconnect"), onClick: sheetActions.onReconnect })
  if (actions.onDisconnect) items.push({ key: "disconnect", icon: Unplug, label: t("Disconnect"), onClick: actions.onDisconnect, destructive: true })
  else if (a && actions.onDelete) items.push({ key: "delete", icon: Trash2, label: t("Delete account"), onClick: () => actions.onDelete!(a), destructive: true })

  const itemClass = (item: Item) =>
    cn(
      "flex min-h-12 w-full items-center gap-3 px-4 text-start text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
      item.destructive ? "text-loss" : "text-foreground",
    )
  const itemBody = (item: Item) => (
    <>
      <item.icon className={cn("size-[18px] shrink-0", item.destructive ? "text-loss" : "text-muted-foreground", item.key === "sync" && syncing && "animate-spin [animation-duration:800ms]")} aria-hidden />
      {item.label}
    </>
  )

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-2 backdrop-blur-sm">
        <Button variant="ghost" onClick={onClose} aria-label={t("Back to Accounts")} className="h-11 gap-2 px-2.5 text-base font-semibold">
          <ArrowLeft className="size-5" />
          {t("Accounts")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            onClose()
            onAddAccount()
          }}
          aria-label={t("Add account")}
          className="size-11 rounded-[10px] border-primary/30 text-primary hover:bg-primary/5 hover:text-primary"
        >
          <Plus className="size-5" />
        </Button>
      </header>

      <div className="p-4">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(20,21,42,0.03)]">
          <div className="flex items-start gap-3 p-4">
            <AccountAvatar name={row.title} logoName={row.logoName} className="size-11 rounded-xl" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-6 font-semibold break-words text-foreground">{row.title}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {t(row.platform)}
                {row.meta ? ` · ${row.meta}` : ""}
              </DialogDescription>
              <div className="mt-2">
                <HealthPill health={status} />
              </div>
            </div>
            <div className="-me-2 -mt-1.5">
              <AccountMenu label={row.title} account={a} actions={sheetActions} syncing={syncing} />
            </div>
          </div>

          {c?.message && !syncing && (
            <p className={cn("mx-4 mb-4 rounded-lg px-3 py-2 text-xs leading-[18px]", messageTone(c.health))} role={c.health === "error" ? "alert" : undefined}>
              {t(c.message)}
            </p>
          )}

          {metrics.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-4 border-t p-4 min-[375px]:grid-cols-3">
              {metrics.map((m) => (
                <div key={m.label} className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{m.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
            <p className="min-w-0 text-xs text-muted-foreground">{c ? lastSyncedLine : t("Trades are added by file import or by hand.")}</p>
            {actions.onSync && (
              <Button className="h-10 shrink-0 px-3.5 hover:bg-primary/90" onClick={actions.onSync} disabled={syncing}>
                <RefreshCw className={cn("size-3.5", syncing && "animate-spin [animation-duration:800ms]")} />
                {syncing ? t("Syncing…") : t("Sync now")}
              </Button>
            )}
          </div>

          {items.length > 0 && (
            <ul className="border-t py-1">
              {items.map((item) => (
                <li key={item.key}>
                  {item.href ? (
                    <Link href={item.href} className={itemClass(item)}>
                      {itemBody(item)}
                    </Link>
                  ) : (
                    <button type="button" onClick={item.onClick} disabled={item.disabled} className={itemClass(item)}>
                      {itemBody(item)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
