import type { HubAccount, HubConnection } from "@/components/accounts/types"
import { PLATFORM_LABEL, formatMoney } from "@/components/accounts/account-ui"
import { useIntlLocale, useT } from "@/components/locale-provider"
import { useRelativeTime } from "@/components/accounts/use-relative-time"

// One account as the Accounts list shows it — a live connection, or an account
// with none (manual entry, file imports) — plus the wording and figures shared
// by its row, its inline details and the phone details screen.
export interface RowModel {
  key: string
  title: string
  platform: string
  meta: string
  logoName: string | null
  status: HubConnection["health"] | "manual" | "archived"
  balance: number | null
  currency: string
  lastSyncedAt: Date | null
  connection: HubConnection | null
  account: HubAccount | null
}

export function connectionRow(c: HubConnection): RowModel {
  return {
    key: c.key,
    title: c.title,
    platform: PLATFORM_LABEL[c.kind],
    meta: c.subtitle,
    logoName: c.logoName,
    status: c.health,
    balance: c.balance,
    currency: c.currency,
    lastSyncedAt: c.lastSyncedAt,
    connection: c,
    account: c.account,
  }
}

export function accountRow(a: HubAccount): RowModel {
  return {
    key: `acct:${a.id}`,
    title: a.name,
    platform: "Manual / file import",
    meta: a.broker ?? "",
    logoName: a.broker,
    status: a.archived ? "archived" : "manual",
    balance: a.currentBalance != null ? Number(a.currentBalance) : Number(a.startingBalance),
    currency: a.currency,
    lastSyncedAt: null,
    connection: null,
    account: a,
  }
}

// The one place sync wording is decided: the Last sync column shows
// "2 minutes ago"; elsewhere it reads "Synced 2 minutes ago" / "Last synced …".
export function useSyncWords(row: RowModel, syncing?: boolean) {
  const t = useT()
  const ago = useRelativeTime()
  const relative = row.lastSyncedAt ? ago(row.lastSyncedAt) : null
  if (!row.connection) return { synced: "—", syncedLine: "", lastSyncedLine: "" }
  if (syncing) return { synced: t("Syncing now…"), syncedLine: t("Syncing now…"), lastSyncedLine: t("Syncing now…") }
  if (!row.lastSyncedAt) return { synced: t("Not synced yet"), syncedLine: t("Not synced yet"), lastSyncedLine: t("Not synced yet") }
  return {
    synced: relative ?? "",
    syncedLine: relative ? t("Synced {ago}", { ago: relative }) : "",
    lastSyncedLine: relative ? t("Last synced {ago}", { ago: relative }) : "",
  }
}

// What the platform reports beyond the row itself (balance, equity, open
// positions…), or a manual account's own figures.
export function useRowMetrics(row: RowModel): { label: string; value: string }[] {
  const t = useT()
  const locale = useIntlLocale()
  const c = row.connection
  const a = row.account
  const metrics: { label: string; value: string }[] = []
  if (c) {
    if (c.balance != null) metrics.push({ label: t("Balance"), value: formatMoney(c.balance, c.currency, locale) })
    if (c.equity != null) metrics.push({ label: t("Equity"), value: formatMoney(c.equity, c.currency, locale) })
    if (c.openPositions != null) metrics.push({ label: t("Open positions"), value: String(c.openPositions) })
    if (c.tradeCount != null) metrics.push({ label: t("Trades journaled"), value: String(c.tradeCount) })
  } else if (a) {
    if (a.currentBalance != null) metrics.push({ label: t("Balance"), value: formatMoney(Number(a.currentBalance), a.currency, locale) })
    metrics.push({ label: t("Starting balance"), value: formatMoney(Number(a.startingBalance), a.currency, locale) })
    metrics.push({ label: t("Currency"), value: a.currency })
  }
  return metrics
}

// Tint for a connection's status message (sync error, queued note…).
export function messageTone(health: HubConnection["health"] | undefined) {
  return health === "error" ? "bg-loss/10 text-loss" : health === "warning" ? "bg-warning/10 text-foreground" : "bg-muted text-muted-foreground"
}
