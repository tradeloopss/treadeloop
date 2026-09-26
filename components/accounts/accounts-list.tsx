"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Info, KeyRound, LayoutDashboard, Link2, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { disconnectRithmic, syncRithmic } from "@/app/actions/rithmic"
import { disconnectMetaTrader, syncMetaTraderNow } from "@/app/actions/metatrader"
import { disconnectTradingView } from "@/app/actions/tradingview"
import { deleteAccount, setAccountArchived } from "@/app/actions/accounts"
import { syncAllConnections } from "@/app/actions/connections"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { AccountAvatar, AccountMenu, HealthPill, formatMoney, type AccountActions } from "@/components/accounts/account-ui"
import { ConfirmDialog, CreateManualAccountDialog, EditAccountDialog } from "@/components/accounts/account-dialogs"
import { AccountDetailsSheet } from "@/components/accounts/account-details-sheet"
import { accountRow, connectionRow, messageTone, useRowMetrics, useSyncWords, type RowModel } from "@/components/accounts/account-rows"
import type { HubAccount, HubConnection } from "@/components/accounts/types"
import { ACCOUNT_LIMIT_MESSAGE, type PlanUsage } from "@/lib/plan-allowance"

// The Accounts page's list of trade sources, as one card: title, count and
// "Sync all"; a compact table with one row per account (identity · platform ·
// status · balance · last sync · ⋯), each expandable for the rest of what that
// platform reports (on phones: a details screen of its own); and a hint +
// "Connect another account" underneath. Live connections first, then accounts
// with no live connection (manual entry, file imports).
//
// Columns follow the card's own width (@container/list):
//   ≥ 760px   Account | Platform | Status | Balance | Last sync | Actions
//   620–759   Account (last sync underneath) | Platform | Status | Balance | ⋯
//   480–619   Account (last sync underneath) | Status | Balance | ⋯
//   < 480     stacked: name + ⋯ / status + balance / last sync

const GRID =
  "grid-cols-[minmax(0,1fr)_auto] @[480px]/list:grid-cols-[minmax(0,1fr)_120px_104px_36px] @[620px]/list:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px_104px_36px] @[760px]/list:grid-cols-[minmax(180px,3fr)_minmax(96px,1fr)_112px_108px_108px_56px]"

type Confirm = { kind: "disconnect"; connection: HubConnection } | { kind: "delete"; account: HubAccount; brokerLinked: boolean }

export function AccountsList({
  connections,
  otherAccounts,
  usage,
  onConnect,
  onReconnect,
}: {
  connections: HubConnection[]
  otherAccounts: HubAccount[]
  usage: PlanUsage | null // Essential's allowance; null on Pro
  onConnect: () => void
  onReconnect: (target: NonNullable<HubConnection["reconnect"]>) => void
}) {
  const t = useT()
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null) // phones: details screen
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
        setExpanded(null)
        setDetail(null)
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

  function actionsFor(row: RowModel): AccountActions {
    const c = row.connection
    const accountActions: AccountActions = row.account
      ? {
          onEdit: (account, mode) => setEditing({ account, mode }),
          onArchive: archive,
          onDelete: (account) => setConfirm({ kind: "delete", account, brokerLinked: c?.kind === "rithmic" }),
        }
      : {}
    if (!c) return accountActions
    return {
      ...accountActions,
      onSync: c.canSync ? () => void syncOne(c) : undefined,
      onReconnect: c.reconnect && c.health === "error" ? () => onReconnect(c.reconnect!) : undefined,
      onDisconnect: () => setConfirm({ kind: "disconnect", connection: c }),
    }
  }

  const liveRows = connections.map(connectionRow)
  const otherRows = otherAccounts.map(accountRow)
  const detailRow = detail ? ([...liveRows, ...otherRows].find((r) => r.key === detail) ?? null) : null

  // Phones get the account's own details screen; wider screens expand the
  // row in place.
  function openRow(key: string) {
    if (window.matchMedia("(max-width: 639px)").matches) setDetail(key)
    else setExpanded((k) => (k === key ? null : key))
  }

  // While a phone's details screen is open these open nested inside it.
  const dialogs = (
    <>
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
    </>
  )

  return (
    <section aria-labelledby="accounts-list-title" className="@container/list rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(20,21,42,0.03)] @[640px]/page:p-5">
      {/* The title with "+ Add account" beside it — the one place to add an
          account, always at the top of the list. Wide cards keep everything
          on one row; narrow ones put the smaller actions underneath, and the
          narrowest give the button a full-width row of its own. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <h2 id="accounts-list-title" className="me-auto text-base leading-6 font-semibold text-foreground @[480px]/list:text-lg">
          {t("Connected accounts")}
        </h2>
        <div className="order-last flex w-full items-center justify-between gap-1.5 @[640px]/list:order-none @[640px]/list:w-auto @[640px]/list:justify-end">
          {/* Essential shows its allowance ("2 of 3 accounts"), Pro just the count. */}
          <span className="me-1 text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
            {usage
              ? t("{n} of {max} accounts", { n: usage.accounts, max: usage.accountLimit })
              : connections.length === 1
                ? t("1 account")
                : t("{n} accounts", { n: connections.length })}
          </span>
          <Button
            variant="ghost"
            onClick={() => (usage && usage.accounts >= usage.accountLimit ? toast.error(t(ACCOUNT_LIMIT_MESSAGE)) : setManualOpen(true))}
            aria-label={t("Manual account")}
            className="h-9 px-2.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            <span className="@[480px]/list:hidden">{t("Manual")}</span>
            <span className="hidden @[480px]/list:inline">{t("Manual account")}</span>
          </Button>
          {syncable.length > 0 && (
            <Button onClick={syncAll} disabled={syncAllPending} variant="outline" className="h-9 rounded-lg border-primary/30 px-3 text-[13px] font-semibold text-primary hover:bg-primary/5 hover:text-primary">
              <RefreshCw className={cn("size-3.5", syncAllPending && "animate-spin [animation-duration:800ms]")} />
              {syncAllPending ? t("Syncing…") : t("Sync all")}
            </Button>
          )}
        </div>
        <Button onClick={onConnect} className="h-11 w-full shrink-0 rounded-[9px] px-3.5 font-semibold hover:bg-primary/90 @[340px]/list:h-10 @[340px]/list:w-auto @[480px]/list:px-4">
          <Plus className="size-4" /> {t("Add account")}
        </Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border">
        {liveRows.length > 0 && (
          <div aria-hidden className={cn("hidden items-center gap-x-3 border-b bg-muted/40 px-4 py-2.5 text-[11px] font-semibold tracking-[0.3px] text-muted-foreground uppercase @[480px]/list:grid", GRID)}>
            <span>{t("Account")}</span>
            <span className="hidden @[620px]/list:block">{t("Platform")}</span>
            <span>{t("Status")}</span>
            <span>{t("Balance")}</span>
            <span className="hidden @[760px]/list:block">{t("Last sync")}</span>
            <span className="text-end">
              <span className="hidden @[760px]/list:inline">{t("Actions")}</span>
            </span>
          </div>
        )}

        {liveRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Link2 className="size-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">{t("No connected accounts yet")}</p>
            <p className="max-w-sm text-[13px] text-muted-foreground">{t("Connect a trading account to automatically bring your trades into TradeLoop.")}</p>
            <Button onClick={onConnect} className="mt-2 h-11 px-4 font-semibold hover:bg-primary/90">
              <Plus className="size-4" /> {t("Connect an account")}
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {liveRows.map((row) => (
              <AccountRow
                key={row.key}
                row={row}
                expanded={expanded === row.key}
                syncing={syncing.has(row.key)}
                onToggle={() => openRow(row.key)}
                actions={actionsFor(row)}
              />
            ))}
          </ul>
        )}

        {otherRows.length > 0 && (
          <>
            <p className="border-y bg-muted/40 px-4 py-2 text-[11px] font-semibold tracking-[0.3px] text-muted-foreground uppercase first:border-t-0">
              {t("Manual & imported")}
            </p>
            <ul className="divide-y">
              {otherRows.map((row) => (
                <AccountRow
                  key={row.key}
                  row={row}
                  expanded={expanded === row.key}
                  onToggle={() => openRow(row.key)}
                  actions={actionsFor(row)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {liveRows.length + otherRows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-1">
          <p className="flex min-w-0 items-center gap-2 py-1.5 text-xs text-muted-foreground">
            <Info className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="sm:hidden">{t("Tap any account to view details, sync status and more options.")}</span>
            <span className="hidden sm:inline">{t("Click any account to view details, sync status and more options.")}</span>
          </p>
          {liveRows.length > 0 && (
            <Button variant="ghost" onClick={onConnect} className="-mx-1.5 h-9 px-1.5 text-xs font-semibold text-primary hover:bg-primary/5 hover:text-primary">
              <Plus className="size-3.5" /> {t("Connect another account")}
            </Button>
          )}
        </div>
      )}

      <AccountDetailsSheet
        row={detailRow}
        syncing={detailRow ? syncing.has(detailRow.key) : false}
        actions={detailRow ? actionsFor(detailRow) : {}}
        onClose={() => setDetail(null)}
        onAddAccount={onConnect}
      >
        {detailRow && dialogs}
      </AccountDetailsSheet>
      {!detailRow && dialogs}
    </section>
  )
}

function AccountRow({
  row,
  expanded,
  syncing,
  onToggle,
  actions,
}: {
  row: RowModel
  expanded: boolean
  syncing?: boolean
  onToggle: () => void
  actions: AccountActions
}) {
  const t = useT()
  const locale = useIntlLocale()
  const status = syncing ? "syncing" : row.status
  const balance = row.balance != null ? formatMoney(row.balance, row.currency, locale) : "—"
  const { synced, syncedLine, lastSyncedLine } = useSyncWords(row, syncing)
  const detailsId = `account-details-${row.key.replace(/[^a-z0-9]/gi, "-")}`
  const platform = t(row.platform)

  return (
    <li className={cn("transition-colors duration-150", expanded ? "bg-primary/[0.025]" : "hover:bg-primary/[0.02]")}>
      {/* The whole row toggles its details for the mouse; the name is the
          real (keyboard-reachable) control, and the ⋯ menu stops its own
          clicks from reaching the row. */}
      <div onClick={onToggle} className={cn("grid min-h-[60px] cursor-pointer items-center gap-x-3 px-4 py-2.5", GRID)}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="-m-1 flex min-w-0 items-center gap-3 rounded-lg p-1 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <AccountAvatar name={row.title} logoName={row.logoName} className="size-8 rounded-lg text-xs" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-foreground @[480px]/list:text-sm">{row.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {platform}
              {row.meta ? ` · ${row.meta}` : ""}
            </span>
            {/* Last sync gets its own column from 760px. */}
            {row.connection && (
              <span className="hidden truncate text-[11px] text-muted-foreground @[480px]/list:block @[760px]/list:hidden">{syncedLine}</span>
            )}
          </span>
        </button>

        <span className="hidden truncate text-[13px] text-foreground @[620px]/list:block">{platform}</span>
        <span className="hidden @[480px]/list:block">
          <HealthPill health={status} />
        </span>
        <span className="hidden text-sm font-semibold tabular-nums text-foreground @[480px]/list:block">{balance}</span>
        <span className="hidden truncate text-xs text-muted-foreground @[760px]/list:block">{synced}</span>
        <span className="flex justify-end">
          <AccountMenu label={row.title} account={row.account} actions={actions} syncing={syncing} />
        </span>

        {/* Phones: status and balance on their own line under the name. */}
        <div className="col-span-2 mt-2 flex items-center justify-between gap-3 ps-11 @[480px]/list:hidden">
          <HealthPill health={status} />
          <span className="text-sm font-semibold tabular-nums text-foreground">{balance}</span>
        </div>
        {row.connection && <p className="col-span-2 mt-1 ps-11 text-[11px] text-muted-foreground @[480px]/list:hidden">{lastSyncedLine}</p>}
      </div>

      <div id={detailsId} className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">{expanded && <RowDetails row={row} syncing={syncing} lastSynced={lastSyncedLine} actions={actions} />}</div>
      </div>
    </li>
  )
}

function RowDetails({ row, syncing, lastSynced, actions }: { row: RowModel; syncing?: boolean; lastSynced: string; actions: AccountActions }) {
  const t = useT()
  const c = row.connection
  const a = row.account
  const metrics = useRowMetrics(row)

  return (
    <div className="space-y-3 border-t border-dashed px-4 py-4 @[480px]/list:ps-[60px]">
      {c?.message && !syncing && (
        <p className={cn("rounded-lg px-3 py-2 text-xs leading-[18px]", messageTone(c.health))} role={c.health === "error" ? "alert" : undefined}>
          {t(c.message)}
        </p>
      )}
      {metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 @[620px]/list:flex @[620px]/list:flex-wrap @[620px]/list:gap-x-10">
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums text-foreground">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* On phones the row itself already shows the last sync. */}
        <p className={cn("text-xs text-muted-foreground", c && "hidden @[480px]/list:block")}>{c ? lastSynced : t("Trades are added by file import or by hand.")}</p>
        <div className="flex flex-wrap gap-2">
          {a && (
            <Button variant="outline" className="h-9" nativeButton={false} render={<Link href={`/accounts/${a.id}`} />}>
              <LayoutDashboard className="size-3.5" /> {t("Open dashboard")}
            </Button>
          )}
          {actions.onReconnect && (
            <Button variant="outline" className="h-9" onClick={actions.onReconnect}>
              <KeyRound className="size-3.5" /> {t("Reconnect")}
            </Button>
          )}
          {actions.onSync && (
            <Button className="h-9 hover:bg-primary/90" onClick={actions.onSync} disabled={syncing}>
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin [animation-duration:800ms]")} />
              {syncing ? t("Syncing…") : t("Sync now")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
