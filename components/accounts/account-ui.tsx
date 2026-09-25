"use client"

import Image from "next/image"
import Link from "next/link"
import { AlertTriangle, Archive, ArchiveRestore, Clock, KeyRound, LayoutDashboard, Loader2, MoreHorizontal, PenLine, Pencil, RefreshCw, SlidersHorizontal, Trash2, Unplug, XCircle } from "lucide-react"
import { brokerLogo } from "@/lib/broker-logos"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useT } from "@/components/locale-provider"
import type { ConnectionHealth, HubAccount, HubConnection } from "@/components/accounts/types"

// Shared pieces of the Accounts page's account list (accounts-list.tsx).

export const PLATFORM_LABEL: Record<HubConnection["kind"], string> = { rithmic: "Rithmic", mt5: "MetaTrader 5", mt4: "MetaTrader 4", tradingview: "TradingView" }

export function HealthPill({ health }: { health: ConnectionHealth | "manual" | "archived" }) {
  const t = useT()
  const spec = {
    manual: { icon: <PenLine aria-hidden className="size-3" />, label: "Manual", className: "bg-muted text-muted-foreground" },
    archived: { icon: <Archive aria-hidden className="size-3" />, label: "Archived", className: "bg-muted text-muted-foreground" },
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
  // Clicks here (including the menu's items, which React bubbles through the
  // portal) must not reach an expandable row around it.
  return (
    <div onClick={(e) => e.stopPropagation()} className="contents">
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="size-11 text-muted-foreground @[480px]/list:size-9" aria-label={t("Actions for {name}", { name: label })}>
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
    </div>
  )
}
