"use server"

import { headers } from "next/headers"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import {
  disconnectTradovate,
  requestTradovateSync,
  setTradovateAccountEnabled,
  tradovateConnectionsFor,
  type ActionResult,
  type TradovateConnectionView,
} from "@/lib/tradovate/connections"

// The Accounts page's Tradovate actions (the /api/integrations/tradovate
// routes expose the same operations as JSON). Results are returned, never
// thrown — Next hides thrown messages in production.

async function userId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

export async function getTradovateConnections(): Promise<TradovateConnectionView[]> {
  const id = await userId()
  return id ? tradovateConnectionsFor(id) : []
}

// Polled by the connect window while the first sync runs.
export async function getTradovateConnection(connectionId: number): Promise<TradovateConnectionView | null> {
  const id = await userId()
  if (!id) return null
  const [view] = await tradovateConnectionsFor(id, connectionId)
  return view ?? null
}

export async function syncTradovateNow(connectionId: number): Promise<ActionResult> {
  const id = await userId()
  if (!id) return { ok: false, error: "Please sign in again." }
  const result = await requestTradovateSync(id, connectionId, (fn) => after(fn))
  revalidatePath("/accounts")
  return result
}

export async function disconnectTradovateConnection(connectionId: number): Promise<ActionResult> {
  const id = await userId()
  if (!id) return { ok: false, error: "Please sign in again." }
  const result = await disconnectTradovate(id, connectionId)
  revalidatePath("/accounts")
  return result
}

// Disconnect (enabled=false) or reconnect one Tradovate account of a login.
export async function setTradovateAccountSync(providerAccountRowId: number, enabled: boolean): Promise<ActionResult> {
  const id = await userId()
  if (!id) return { ok: false, error: "Please sign in again." }
  const result = await setTradovateAccountEnabled(id, providerAccountRowId, enabled)
  revalidatePath("/accounts")
  return result
}
