// View models for the Accounts page (app/(app)/accounts/page.tsx builds them
// from real rows; nothing here is ever filled with placeholder data).

export type PlatformId = "rithmic" | "mt5" | "mt4" | "tradingview" | "file" | "tradovate"

// connected: syncing normally · syncing: first sync or a sync in flight ·
// queued: waiting on our side (e.g. MT4 being set up) · warning: last sync
// failed but it's still retrying · error: needs the user (e.g. rejected login).
export type ConnectionHealth = "connected" | "syncing" | "queued" | "warning" | "error"

// A trading account row, for the ⋯ menu's edit/archive/delete actions.
export interface HubAccount {
  id: number
  name: string
  broker: string | null
  startingBalance: string
  currentBalance: string | null
  currency: string
  commissionPerContract: string | null
  archived: boolean
}

// One live connection (a card in "Your connected accounts").
export interface HubConnection {
  key: string
  kind: "rithmic" | "mt5" | "mt4" | "tradingview" | "tradovate" | "ninjatrader"
  connectionId: number
  providerAccountRowId?: number // tradovate / ninjatrader: this account's provider_accounts row (per-account disconnect)
  credentialLogin?: boolean // a Tradovate-via-NinjaTrader VPS login row (disconnect removes the whole login)
  title: string
  subtitle: string
  logoName: string | null // matched against lib/broker-logos
  health: ConnectionHealth
  message: string | null // why it's queued / warning / failed
  currency: string
  // Only what the platform really reports; null = not available there.
  balance: number | null
  equity: number | null
  openPositions: number | null
  tradeCount: number | null
  lastSyncedAt: Date | null
  canSync: boolean // has a manual "Sync now"
  account: HubAccount | null
  reconnect: { platform: "mt5" | "mt4" | "tradovate"; server?: string; login?: string } | null
  // Connection health details shown with the account (e.g. Tradovate's
  // realtime state, last event, last reconciliation). `at` is shown as a
  // relative time.
  diagnostics?: { label: string; value?: string; at?: string | null }[]
}
