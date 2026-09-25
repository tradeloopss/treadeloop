"use client"

import Image from "next/image"
import Link from "next/link"
import { AlertTriangle, Archive, ArchiveRestore, Clock, KeyRound, LayoutDashboard, Loader2, MoreHorizontal, Pencil, RefreshCw, SlidersHorizontal, Trash2, Unplug, XCircle } from "lucide-react"
import { brokerLogo } from "@/lib/broker-logos"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { useRelativeTime } from "@/components/accounts/use-relative-time"
import type { ConnectionHealth, HubAccount, HubConnection } from "@/components/accounts/types"

const PLATFORM_LABEL: Record<HubConnection["kind"], string> = { rithmic: "Rithmic", mt5: "MetaTrader 5", mt4: "MetaTrader 4", tradingview: "TradingView" }

export function HealthPill({ health }: { health: ConnectionHealth }) {
  const t = useT()
  const spec = {
    connected: { icon: <span aria-hidden className="size-1.5 rounded-full bg-current" />, label: "Connected", className: "bg-gain/10 text-gain" },
    syncing: { icon: <Loader2 aria-hidden className="size-3 animate-spin [animation-duration:800ms]" />, label: "Syncing…", className: "bg-primary/10 text-primary" },
    queued: { icon: <Clock aria-hidden className="size-3" />, label: "Queued", className: "bg-muted text-muted-foreground" },
    warning: { icon: <AlertTriangle aria-hidden className="size-3" />, label: "Sync issue", className: "bg-warning/15 text-warning" },
    error: { icon: <XCircle aria-hidden className="size-3" />, label: "Connection failed", className: "bg-loss/10 text-loss" },
  }[health]
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap", spec.className)}>
      {spec.icon}
      {t(spec.label)}
    </span>
  )
}

export function AccountAvatar({ name, logoName, className }: { name: string; logoName: string | null; className?: string }) {
  const logo = brokerLogo(logoName ?? name)
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-primary/10 text-sm font-semibold text-primary", className)}>
      {logo ? <Image src={logo} alt="" width={40} height={40} className="size-full object-cover" /> : (name.trim().charAt(0) || "?").toUpperCase()}
    </span>
  )
}

export function formatMoney(n: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

export interface AccountActions {
  onSync?: () => void
  onReconnect?: () => void
  onDisconnect?: () => void
  onEdit?: (account: HubAccount, mode: "edit" | "balance") => void
  onArchive?: (account: HubAccount) => void
  onDelete?: (account: HubAccount) => void
}

export function AccountMenu({ label, account, actions, syncing }: { label: string; account: HubAccount | null; actions: AccountActions; syncing?: boolean }) {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={t("Actions for {name}", { name: label })}>
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {actions.onSync && (
          <DropdownMenuItem onClick={actions.onSync} disabled={syncing}>
            <RefreshCw className="size-4" /> {t("Sync now")}
          </DropdownMenuItem>
        )}
        {actions.onReconnect && (
          <DropdownMenuItem onClick={actions.onReconnect}>
            <KeyRound className="size-4" /> {t("Reconnect")}
          </DropdownMenuItem>
        )}
        {account && (
          <>
            <DropdownMenuItem render={<Link href={`/accounts/${account.id}`} />}>
              <LayoutDashboard className="size-4" /> {t("Open account dashboard")}
            </DropdownMenuItem>
            {actions.onEdit && (
              <>
                <DropdownMenuItem onClick={() => actions.onEdit!(account, "edit")}>
                  <Pencil className="size-4" /> {t("Edit details")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onEdit!(account, "balance")}>
                  <SlidersHorizontal className="size-4" /> {t("Edit balance")}
                </DropdownMenuItem>
              </>
            )}
            {actions.onArchive && (
              <DropdownMenuItem onClick={() => actions.onArchive!(account)}>
                {account.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                {account.archived ? t("Restore account") : t("Archive account")}
              </DropdownMenuItem>
            )}
          </>
        )}
        {(actions.onDisconnect || (account && actions.onDelete)) && <DropdownMenuSeparator />}
        {actions.onDisconnect && (
          <DropdownMenuItem onClick={actions.onDisconnect}>
            <Unplug className="size-4" /> {t("Disconnect")}
          </DropdownMenuItem>
        )}
        {account && actions.onDelete && (
          <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete!(account)}>
            <Trash2 className="size-4" /> {t("Delete account")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ConnectedAccountCard({ connection, syncing, actions }: { connection: HubConnection; syncing?: boolean; actions: AccountActions }) {
  const t = useT()
  const locale = useIntlLocale()
  const ago = useRelativeTime()
  const health: ConnectionHealth = syncing ? "syncing" : connection.health

  const metrics: { label: string; value: string }[] = []
  if (connection.balance != null) metrics.push({ label: t("Balance"), value: formatMoney(connection.balance, connection.currency, locale) })
  if (connection.equity != null) metrics.push({ label: t("Equity"), value: formatMoney(connection.equity, connection.currency, locale) })
  if (connection.openPositions != null) metrics.push({ label: t("Open positions"), value: String(connection.openPositions) })
  if (connection.tradeCount != null) metrics.push({ label: t("Trades journaled"), value: String(connection.tradeCount) })

  const synced = ago(connection.lastSyncedAt)
  const messageTone =
    connection.health === "error" ? "bg-loss/10 text-loss" : connection.health === "warning" ? "bg-warning/10 text-foreground" : "bg-muted text-muted-foreground"

  return (
    <article className="@container/card rounded-xl border bg-card shadow-[0_1px_2px_rgba(20,21,42,0.03)]" aria-label={connection.title}>
      <div className="flex items-start gap-3 p-4">
        <AccountAvatar name={connection.title} logoName={connection.logoName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{connection.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t(PLATFORM_LABEL[connection.kind])} · {connection.subtitle}
          </p>
          {/* Narrow cards: status under the name so the name keeps its width. */}
          <div className="mt-2 @[340px]/card:hidden">
            <HealthPill health={health} />
          </div>
        </div>
        <div className="hidden @[340px]/card:block">
          <HealthPill health={health} />
        </div>
      </div>

      {connection.message && !syncing && (
        <p className={cn("mx-4 mb-3 rounded-lg px-3 py-2 text-xs leading-[18px]", messageTone)} role={connection.health === "error" ? "alert" : undefined}>
          {t(connection.message)}
        </p>
      )}

      {metrics.length > 0 && (
        <dl className={cn("grid gap-x-3 gap-y-3 border-t px-4 py-3", metrics.length >= 3 ? "grid-cols-2 @[300px]/card:grid-cols-3" : "grid-cols-2")}>
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="truncate text-[11px] text-muted-foreground">{m.label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums text-foreground">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex min-h-10 items-center justify-between gap-2 border-t ps-4 pe-2 text-[11px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {syncing ? t("Syncing now…") : synced ? t("Last synced {ago}", { ago: synced }) : synced === "" ? "" : t("Waiting for the first sync")}
          </span>
        </span>
        <AccountMenu label={connection.title} account={connection.account} actions={actions} syncing={syncing} />
      </div>
    </article>
  )
}
