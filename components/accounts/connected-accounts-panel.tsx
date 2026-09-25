"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Link2, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { disconnectRithmic, syncRithmic } from "@/app/actions/rithmic"
import { disconnectMetaTrader, syncMetaTraderNow } from "@/app/actions/metatrader"
import { disconnectTradingView } from "@/app/actions/tradingview"
import { deleteAccount, setAccountArchived } from "@/app/actions/accounts"
import { syncAllConnections } from "@/app/actions/connections"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { AccountAvatar, AccountMenu, ConnectedAccountCard, formatMoney, type AccountActions } from "@/components/accounts/connected-account-card"
import { ConfirmDialog, CreateManualAccountDialog, EditAccountDialog } from "@/components/accounts/account-dialogs"
import type { HubAccount, HubConnection } from "@/components/accounts/types"

type Confirm =
  | { kind: "disconnect"; connection: HubConnection }
  | { kind: "delete"; account: HubAccount; brokerLinked: boolean }

export function ConnectedAccountsPanel({
  connections,
  otherAccounts,
  onConnectAnother,
  onReconnect,
}: {
  connections: HubConnection[]
  otherAccounts: HubAccount[]
  onConnectAnother: () => void
  onReconnect: (target: NonNullable<HubConnection["reconnect"]>) => void
}) {
  const t = useT()
  const locale = useIntlLocale()
  const router = useRouter()
  const [syncing, setSyncing] = useState<Set<string>>(new Set())
  const [syncAllPending, startSyncAll] = useTransition()
  const [actionPending, startAction] = useTransition()
  const [editing, setEditing] = useState<{ account: HubAccount; mode: "edit" | "balance" } | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [manualOpen, setManualOpen] = useState(false)

  const syncable = connections.filter((c) => c.canSync)

  function markSyncing(key: string, on: boolean) {
    setSyncing((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function syncOne(c: HubConnection) {
    markSyncing(c.key, true)
    try {
      if (c.kind === "rithmic") {
        const result = await syncRithmic(c.connectionId)
        toast.success(result.imported > 0 ? (result.imported === 1 ? t("Imported 1 trade") : t("Imported {n} trades", { n: result.imported })) : t("Already up to date"))
      } else {
        await syncMetaTraderNow(c.connectionId)
        toast.success(t("Syncing — new trades will appear in a few seconds"))
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? t(err.message) : t("Sync failed"))
    } finally {
      markSyncing(c.key, false)
    }
  }

  function syncAll() {
    startSyncAll(async () => {
      try {
        const r = await syncAllConnections()
        const parts: string[] = []
        if (r.synced > 0) parts.push(r.imported === 1 ? t("1 new trade") : t("{n} new trades", { n: r.imported }))
        if (r.queued > 0) parts.push(r.queued === 1 ? t("1 MetaTrader account syncing") : t("{n} MetaTrader accounts syncing", { n: r.queued }))
        if (r.failed > 0) toast.error(r.failed === 1 ? t("1 account couldn't sync — it will retry automatically") : t("{n} accounts couldn't sync — they will retry automatically", { n: r.failed }))
        toast.success(parts.length ? t("Sync started — {detail}", { detail: parts.join(" · ") }) : t("Everything is up to date"))
        router.refresh()
      } catch {
        toast.error(t("Sync failed"))
      }
    })
  }

  function runConfirmed() {
    if (!confirm) return
    const current = confirm
    startAction(async () => {
      try {
        if (current.kind === "disconnect") {
          const c = current.connection
          if (c.kind === "rithmic") await disconnectRithmic(c.connectionId)
          else if (c.kind === "tradingview") await disconnectTradingView(c.connectionId)
          else await disconnectMetaTrader(c.connectionId)
          toast.success(t("Disconnected"))
        } else {
          await deleteAccount(current.account.id)
          toast.success(t("Removed {name}", { name: current.account.name }))
        }
        setConfirm(null)
        router.refresh()
      } catch {
        toast.error(current.kind === "disconnect" ? t("Could not disconnect") : t("Could not remove account"))
      }
    })
  }

  function archive(account: HubAccount) {
    startAction(async () => {
      try {
        await setAccountArchived(account.id, !account.archived)
        toast.success(account.archived ? t("{name} restored", { name: account.name }) : t("{name} archived", { name: account.name }))
        router.refresh()
      } catch {
        toast.error(t("Could not update account"))
      }
    })
  }

  const accountActions = (brokerLinked: boolean): Pick<AccountActions, "onEdit" | "onArchive" | "onDelete"> => ({
    onEdit: (account, mode) => setEditing({ account, mode }),
    onArchive: archive,
    onDelete: (account) => setConfirm({ kind: "delete", account, brokerLinked }),
  })

  return (
    <section aria-labelledby="connected-accounts-title" className="rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="connected-accounts-title" className="text-lg font-semibold tracking-tight text-foreground">
            {t("Your connected accounts")}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t("Manage your linked accounts, sync status and imported data.")}</p>
        </div>
        {syncable.length > 0 && (
          <Button
            variant="secondary"
            onClick={syncAll}
            disabled={syncAllPending}
            className="h-9 shrink-0 rounded-lg bg-primary/10 px-3 text-[13px] font-semibold text-primary hover:bg-primary/15"
          >
            <RefreshCw className={cn("size-3.5", syncAllPending && "animate-spin [animation-duration:800ms]")} />
            {syncAllPending ? t("Syncing…") : t("Sync all")}
          </Button>
        )}
      </div>

      {connections.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Link2 className="size-5" />
          </span>
          <p className="text-sm font-semibold text-foreground">{t("No accounts connected")}</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">{t("Connect a trading account to automatically import your trades into TradeLoop.")}</p>
          <Button onClick={onConnectAnother} className="mt-2 h-11 px-4 font-semibold hover:bg-primary/90">
            <Plus className="size-4" /> {t("Connect an account")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {connections.map((c) => (
            <ConnectedAccountCard
              key={c.key}
              connection={c}
              syncing={syncing.has(c.key)}
              actions={{
                onSync: c.canSync ? () => void syncOne(c) : undefined,
                onReconnect: c.reconnect && c.health === "error" ? () => onReconnect(c.reconnect!) : undefined,
                onDisconnect: () => setConfirm({ kind: "disconnect", connection: c }),
                ...(c.account ? accountActions(c.kind === "rithmic") : {}),
              }}
            />
          ))}
          <Button onClick={onConnectAnother} className="h-11 w-full rounded-[9px] text-[13px] font-semibold hover:bg-primary/90">
            <Plus className="size-4" /> {t("Connect another account")}
          </Button>
        </div>
      )}

      {/* Accounts with no live connection: manual, file imports, disconnected. */}
      <div className="mt-6 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{t("Other accounts")}</h3>
          <Button variant="ghost" size="sm" onClick={() => setManualOpen(true)} className="h-9 text-[13px] text-primary">
            <Plus className="size-3.5" /> {t("Manual account")}
          </Button>
        </div>
        {otherAccounts.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("Accounts you create by hand or through a file import appear here.")}</p>
        ) : (
          <ul className="mt-2 divide-y">
            {otherAccounts.map((a) => {
              const balance = a.currentBalance != null ? Number(a.currentBalance) : Number(a.startingBalance)
              return (
                <li key={a.id} className={cn("flex items-center gap-3 py-2.5", a.archived && "opacity-60")}>
                  <AccountAvatar name={a.name} logoName={a.broker} className="size-9 text-xs" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/accounts/${a.id}`} className="block truncate text-sm font-medium text-foreground hover:underline">
                      {a.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[a.broker, a.archived ? t("Archived") : t("Manual / file import")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(balance, a.currency, locale)}</span>
                  <AccountMenu label={a.name} account={a} actions={accountActions(false)} />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <EditAccountDialog
        account={editing?.account ?? null}
        mode={editing?.mode ?? "edit"}
        onClose={() => {
          setEditing(null)
          router.refresh()
        }}
      />
      <CreateManualAccountDialog
        open={manualOpen}
        onOpenChange={(o) => {
          setManualOpen(o)
          if (!o) router.refresh()
        }}
      />
      <ConfirmDialog
        open={confirm != null}
        pending={actionPending}
        destructive
        title={confirm?.kind === "delete" ? t("Delete {name}?", { name: confirm.account.name }) : t("Disconnect {name}?", { name: confirm?.connection.title ?? "" })}
        description={
          confirm?.kind === "delete"
            ? confirm.brokerLinked
              ? t("This removes the account, its connection and its synced trades. Reconnecting later re-imports the full history.")
              : t("This removes the account. Its trades stay in your journal, just no longer tagged to an account.")
            : confirm?.connection.kind === "tradingview"
              ? t("Sync from this paper account stops. The account and the trades already imported stay in your journal.")
              : t("Sync stops and the saved login is deleted. The account and the trades already imported stay in your journal.")
        }
        confirmLabel={confirm?.kind === "delete" ? t("Delete account") : t("Disconnect")}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </section>
  )
}
